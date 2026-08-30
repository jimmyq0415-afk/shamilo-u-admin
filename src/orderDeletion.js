export async function deleteOrder(client, orderId) {
  // Never issue an unfiltered delete, even if a stale button has lost its id.
  const validId = typeof orderId === 'number'
    ? Number.isSafeInteger(orderId) && orderId > 0
    : typeof orderId === 'string' && /^[1-9]\d*$/.test(orderId)
  if (!validId) throw new Error('訂單編號無效，未執行刪除。')

  // order_items.order_id already has ON DELETE CASCADE in the original database.
  // One parent DELETE keeps the order and its items atomic; do not delete items first.
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 15000)
  let result
  try {
    result = await client
      .from('orders')
      .delete()
      .eq('id', orderId)
      .select('id')
      .abortSignal(abort.signal)
  } finally {
    clearTimeout(timeout)
  }
  if (abort.signal.aborted) {
    throw new Error('連線逾時，無法確認刪除結果。請重新整理訂單後再試。')
  }
  const { data, error } = result

  if (error) {
    if (error.code === '23503') {
      throw new Error('這筆訂單仍有其他資料關聯，未刪除。請檢查資料庫關聯設定。')
    }
    throw new Error(error.message || '資料庫拒絕刪除，請檢查連線與管理權限。')
  }
  if (!Array.isArray(data) || data.length !== 1 || String(data[0]?.id) !== String(orderId)) {
    throw new Error('未確認刪除任何訂單；可能已由其他裝置刪除，或目前沒有刪除權限。請重新整理確認。')
  }
  return data[0].id
}
