const BATCH_SIZE = 100

function checkedIds(ids) {
  if (!Array.isArray(ids)) throw new Error('訂單清單無效，未執行操作。')
  const unique = new Map()
  for (const id of ids) {
    const valid = typeof id === 'number'
      ? Number.isSafeInteger(id) && id > 0
      : typeof id === 'string' && /^[1-9]\d*$/.test(id)
    if (!valid) throw new Error('訂單編號無效，未執行操作。')
    if (!unique.has(String(id))) unique.set(String(id), id)
  }
  return [...unique.values()]
}

async function request(buildQuery) {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 15000)
  try {
    const result = await buildQuery().abortSignal(abort.signal)
    if (abort.signal.aborted) throw new Error('連線逾時，結果無法確認；請重新整理後再操作。')
    if (result.error) throw new Error(result.error.message || '資料庫拒絕操作。')
    return result
  } finally {
    clearTimeout(timeout)
  }
}

// Keyset pagination avoids the API row limit and offset skips after concurrent deletions.
export async function readAllOrderRows(client, table) {
  if (!['orders', 'order_items'].includes(table)) throw new Error('不支援的訂單資料表。')
  const rows = []
  let lastId = null
  while (true) {
    const { data, count } = await request(() => {
      let query = client.from(table).select('*', { count: 'exact' }).order('id', { ascending: true }).limit(500)
      if (lastId !== null) query = query.gt('id', lastId)
      return query
    })
    if (!Array.isArray(data)) throw new Error('訂單讀取格式異常。')
    if (!data.length) return rows
    const ids = checkedIds(data.map(row => row.id))
    if (ids.length !== data.length || ids.some((id, index) =>
      BigInt(id) <= BigInt(index ? ids[index - 1] : lastId ?? 0))) {
      throw new Error('訂單分頁順序異常，已停止讀取。')
    }
    rows.push(...data)
    if (typeof count === 'number' && data.length >= count) return rows
    lastId = ids[ids.length - 1]
  }
}

async function mutateSnapshot(client, targetIds, action) {
  // Freeze and validate every id before the first request. Never use an unbounded DELETE.
  const ids = checkedIds(targetIds)
  const affected = new Set()
  let error = null
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + BATCH_SIZE)
    try {
      const { data } = await request(() => {
        let query = action === 'accept'
          ? client.from('orders').update({ status: 'accepted' }).eq('status', 'pending')
          : client.from('orders').delete()
        query = query.in('id', chunk).select('id')
        return query
      })
      if (!Array.isArray(data)) throw new Error('回傳結果無法確認，請重新整理訂單。')
      const returned = data.map(row => String(row?.id))
      const allowed = new Set(chunk.map(String))
      if (new Set(returned).size !== returned.length || returned.some(id => !allowed.has(id))) {
        throw new Error('回傳的訂單編號不符，請重新整理確認結果。')
      }
      returned.forEach(id => affected.add(id))
    } catch (cause) {
      error = cause instanceof TypeError ? '連線中斷，無法確認這批訂單的結果。' : cause.message
      // A failed/uncertain batch is not retried; preserve the exact confirmed count.
      break
    }
  }
  return {
    affectedIds: ids.filter(id => affected.has(String(id))),
    unconfirmedIds: ids.filter(id => !affected.has(String(id))),
    error,
  }
}

export const acceptOrderSnapshot = (client, ids) => mutateSnapshot(client, ids, 'accept')
// Existing order_items FK cascade deletes each batch and its details atomically.
export const deleteOrderSnapshot = (client, ids) => mutateSnapshot(client, ids, 'delete')
