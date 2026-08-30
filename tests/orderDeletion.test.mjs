import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteOrder } from '../src/orderDeletion.js'

function database(result = { data: [{ id: 78 }], error: null }) {
  const calls = []
  const client = {
    from(table) { calls.push(['from', table]); return this },
    delete() { calls.push(['delete']); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    select(columns) {
      calls.push(['select', columns])
      return this
    },
    async abortSignal(signal) {
      assert.equal(signal instanceof AbortSignal, true)
      if (result instanceof Error) throw result
      return result
    },
  }
  return { client, calls }
}

test('delete exactly one selected parent and require its returned id', async () => {
  const db = database()
  assert.equal(await deleteOrder(db.client, 78), 78)
  assert.deepEqual(db.calls, [['from', 'orders'], ['delete'], ['eq', 'id', 78], ['select', 'id']])
  // The database cascade handles items atomically, never a separate items DELETE.
  assert.equal(db.calls.some(call => call.includes('order_items')), false)
})

test('string bigint ids remain exact without numeric rounding', async () => {
  const id = '9007199254740993'
  const db = database({ data: [{ id }], error: null })
  assert.equal(await deleteOrder(db.client, id), id)
  assert.deepEqual(db.calls[2], ['eq', 'id', id])
})

test('missing, invalid and unsafe ids never send a delete', async () => {
  for (const id of [undefined, null, '', 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, [], '1,2', 'eq.1', '01']) {
    const db = database()
    await assert.rejects(deleteOrder(db.client, id), /編號無效/)
    assert.deepEqual(db.calls, [])
  }
})

test('zero deleted rows must not report success', async () => {
  const db = database({ data: [], error: null })
  await assert.rejects(deleteOrder(db.client, 78), /未確認刪除任何訂單/)
})

test('unexpected representations must not report success', async () => {
  for (const data of [null, {}, [{ id: 79 }], [{ id: 78 }, { id: 79 }]]) {
    const db = database({ data, error: null })
    await assert.rejects(deleteOrder(db.client, 78), /未確認刪除任何訂單/)
  }
})

test('permission errors are shown, not swallowed', async () => {
  const db = database({ data: null, error: { code: '42501', message: 'permission denied' } })
  await assert.rejects(deleteOrder(db.client, 78), /permission denied/)
})

test('foreign-key errors do not trigger destructive fallback requests', async () => {
  const db = database({ data: null, error: { code: '23503', message: 'foreign key violation' } })
  await assert.rejects(deleteOrder(db.client, 78), /其他資料關聯/)
  assert.equal(db.calls.filter(([action]) => action === 'delete').length, 1)
})

test('network failures remain failures and do not blindly retry a delete', async () => {
  const db = database(new TypeError('Failed to fetch'))
  await assert.rejects(deleteOrder(db.client, 78), /Failed to fetch/)
  assert.equal(db.calls.filter(([action]) => action === 'delete').length, 1)
})
