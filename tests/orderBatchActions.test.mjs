import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptOrderSnapshot, deleteOrderSnapshot, readAllOrderRows } from '../src/orderBatchActions.js'

function database(initial = []) {
  const db = { rows: initial.map(row => ({ ...row })), items: [], requests: [], cap: 500, failMutation: 0, mutations: 0, before: null, representation: null }
  db.client = { from(table) {
    const q = { table, action: 'read', ids: null, status: null, after: null, limit: 500 }
    return {
      select() { return this }, order() { return this },
      limit(n) { q.limit = n; return this },
      gt(column, value) { assert.equal(column, 'id'); q.after = value; return this },
      eq(column, value) { assert.equal(column, 'status'); q.status = value; return this },
      in(column, values) { assert.equal(column, 'id'); q.ids = [...values]; return this },
      update(payload) { assert.deepEqual(payload, { status: 'accepted' }); q.action = 'accept'; return this },
      delete() { q.action = 'delete'; return this },
      async abortSignal(signal) {
        assert.equal(signal instanceof AbortSignal, true)
        db.requests.push(structuredClone(q))
        if (db.before) await db.before(q)
        if (q.action === 'read') {
          const rows = (table === 'orders' ? db.rows : db.items)
            .filter(row => q.after === null || BigInt(row.id) > BigInt(q.after))
            .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
          return { data: rows.slice(0, Math.min(q.limit, db.cap)).map(row => ({ ...row })), count: rows.length, error: null }
        }
        db.mutations += 1
        if (db.failMutation === db.mutations) throw new TypeError('Failed to fetch')
        assert.equal(table, 'orders')
        assert.ok(q.ids?.length, 'a mutation must have an explicit non-empty id filter')
        const ids = new Set(q.ids.map(String))
        const selected = db.rows.filter(row => ids.has(String(row.id)) && (q.status === null || row.status === q.status))
        if (q.action === 'accept') selected.forEach(row => { row.status = 'accepted' })
        else {
          db.rows = db.rows.filter(row => !ids.has(String(row.id)))
          db.items = db.items.filter(item => !ids.has(String(item.order_id)))
        }
        return { data: db.representation ?? selected.map(row => ({ id: row.id })), error: null }
      },
    }
  } }
  return db
}

test('empty lists never issue any mutation', async () => {
  const db = database()
  assert.deepEqual(await acceptOrderSnapshot(db.client, []), { affectedIds: [], unconfirmedIds: [], error: null })
  await deleteOrderSnapshot(db.client, [])
  assert.equal(db.requests.length, 0)
})

test('validate the entire list before deleting even the first valid id', async () => {
  for (const id of [undefined, null, '', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1,2', 'eq.1']) {
    const db = database([{ id: 1 }])
    await assert.rejects(deleteOrderSnapshot(db.client, [1, id]), /編號無效/)
    assert.equal(db.requests.length, 0)
  }
})

test('accept only pending ids in the snapshot, never a newly arriving order', async () => {
  const db = database([{ id: 1, status: 'pending' }, { id: 2, status: 'accepted' }, { id: 3, status: 'cancelled' }])
  db.before = () => { db.before = null; db.rows.push({ id: 4, status: 'pending' }) }
  const result = await acceptOrderSnapshot(db.client, [1, 2, 3])
  assert.deepEqual(result.affectedIds, [1])
  assert.deepEqual(result.unconfirmedIds, [2, 3])
  assert.equal(db.rows.find(row => row.id === 4).status, 'pending')
  assert.equal(db.requests[0].status, 'pending')
})

test('bulk delete includes accepted orders, preserves newer orders and their details', async () => {
  const db = database([{ id: 1, status: 'pending' }, { id: 2, status: 'accepted' }, { id: 3, status: 'pending' }])
  db.items = [{ id: 1, order_id: 1 }, { id: 2, order_id: 2 }, { id: 3, order_id: 3 }]
  const result = await deleteOrderSnapshot(db.client, [1, 2])
  assert.deepEqual(result.affectedIds, [1, 2])
  assert.deepEqual(db.rows.map(row => row.id), [3])
  assert.deepEqual(db.items.map(row => row.order_id), [3])
  assert.ok(db.requests.every(q => q.table === 'orders'))
})

test('deduplicate ids without rounding string bigint identifiers', async () => {
  const id = '9007199254740993'
  const db = database([{ id: 1 }, { id }])
  const result = await deleteOrderSnapshot(db.client, [1, '1', id])
  assert.deepEqual(result.affectedIds, [1, id])
  assert.deepEqual(db.requests[0].ids, [1, id])
})

test('large selections use bounded batches, each with explicit ids', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: i + 1 }))
  const db = database(rows)
  const result = await deleteOrderSnapshot(db.client, rows.map(row => row.id))
  assert.equal(result.affectedIds.length, 205)
  assert.deepEqual(db.requests.map(q => q.ids.length), [100, 100, 5])
})

test('a failed batch reports confirmed partial success and stops without retry', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: i + 1 }))
  const db = database(rows); db.failMutation = 2
  const result = await deleteOrderSnapshot(db.client, rows.map(row => row.id))
  assert.equal(result.affectedIds.length, 100)
  assert.equal(result.unconfirmedIds.length, 105)
  assert.match(result.error, /連線中斷/)
  assert.equal(db.mutations, 2)
  assert.equal(db.rows.length, 105)
})

test('zero affected rows cannot be reported as fully successful', async () => {
  const db = database()
  const result = await deleteOrderSnapshot(db.client, [1, 2])
  assert.deepEqual(result.affectedIds, [])
  assert.deepEqual(result.unconfirmedIds, [1, 2])
})

test('unexpected or duplicate returned ids remain unconfirmed', async () => {
  for (const representation of [[{ id: 999 }], [{ id: 1 }, { id: 1 }], {}]) {
    const db = database([{ id: 1 }]); db.representation = representation
    const result = await deleteOrderSnapshot(db.client, [1])
    assert.equal(result.affectedIds.length, 0)
    assert.ok(result.error)
  }
})

test('reads every page even when the server row cap is smaller than requested', async () => {
  const db = database(Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }))); db.cap = 2
  const rows = await readAllOrderRows(db.client, 'orders')
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(db.requests.map(q => q.after), [null, 2, 4, 6])
})

test('keyset pagination does not skip rows if earlier orders are concurrently deleted', async () => {
  const db = database(Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }))); db.cap = 2
  db.before = q => { if (q.after !== null) db.rows = db.rows.filter(row => row.id !== 1) }
  assert.deepEqual((await readAllOrderRows(db.client, 'orders')).map(row => row.id), [1, 2, 3, 4, 5])
})

test('refuse to load an unrelated table', async () => {
  const db = database()
  await assert.rejects(readAllOrderRows(db.client, 'menu_items'), /不支援/)
  assert.equal(db.requests.length, 0)
})
