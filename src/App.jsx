import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { deleteOrder } from './orderDeletion'

const adminColors = {
  primary: '#384C65',
  soft: '#CCCBC9',
  light: '#F8F9EE',
  mid: '#A59387',
  dark: '#717171',
}

const emptyForm = {
  name: '',
  price: '',
  note: '',
  category: '',
  image_url: '',
  is_available: true,
  allow_custom_note: true,
}

const emptyOptionForm = {
  label: '',
  price_delta: '',
}

const emptyCategoryForm = {
  name: '',
  sort_order: '',
}

export default function App() {
  const [menuItems, setMenuItems] = useState([])
  const [menuCategories, setMenuCategories] = useState([])
  const [optionsMap, setOptionsMap] = useState({})
  const [orders, setOrders] = useState([])
  const [orderItemsMap, setOrderItemsMap] = useState({})
  const [orderToDelete, setOrderToDelete] = useState(null)
  const [deletingOrderId, setDeletingOrderId] = useState(null)
  const [orderMessage, setOrderMessage] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const deleteDialogRef = useRef(null)
  const deleteInFlight = useRef(false)
  const ordersRequestId = useRef(0)
  const ordersFetchBusy = useRef(false)

  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)
  const [editingCategoryId, setEditingCategoryId] = useState(null)
  const [categoryLoading, setCategoryLoading] = useState(false)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [optionForms, setOptionForms] = useState({})
  const [optionLoadingId, setOptionLoadingId] = useState(null)

  async function fetchMenuItems() {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('id', { ascending: true })

    if (error) {
      setMessage('讀取商品失敗：' + error.message)
      return
    }

    setMenuItems(data || [])
  }

  async function fetchMenuCategories() {
    const { data, error } = await supabase
      .from('menu_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      setMessage('讀取分類失敗：' + error.message)
      return
    }

    setMenuCategories(data || [])
  }

  async function fetchOptions() {
    const { data, error } = await supabase
      .from('menu_item_options')
      .select('*')
      .order('id', { ascending: true })

    if (error) {
      setMessage('讀取選項失敗：' + error.message)
      return
    }

    const grouped = {}
    ;(data || []).forEach((item) => {
      if (!grouped[item.menu_item_id]) grouped[item.menu_item_id] = []
      grouped[item.menu_item_id].push(item)
    })
    setOptionsMap(grouped)
  }

  async function fetchOrders() {
    if (ordersFetchBusy.current) return
    ordersFetchBusy.current = true
    const requestId = ++ordersRequestId.current
    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })

      if (requestId !== ordersRequestId.current) return
      if (ordersError) throw new Error(ordersError.message)

      const { data: orderItemsData, error: orderItemsError } = await supabase
        .from('order_items')
        .select('*')
        .order('id', { ascending: true })

      if (requestId !== ordersRequestId.current) return
      if (orderItemsError) throw new Error('訂單明細：' + orderItemsError.message)

      const grouped = {}
      ;(orderItemsData || []).forEach((item) => {
        if (!grouped[item.order_id]) grouped[item.order_id] = []
        grouped[item.order_id].push(item)
      })
      setOrders(ordersData || [])
      setOrderItemsMap(grouped)
    } catch (error) {
      if (requestId === ordersRequestId.current) setOrderMessage('讀取訂單失敗：' + error.message)
    } finally {
      ordersFetchBusy.current = false
    }
  }

  async function refreshAll() {
    await Promise.all([fetchMenuItems(), fetchMenuCategories(), fetchOptions(), fetchOrders()])
  }

  useEffect(() => {
    // Data loading is asynchronous; schedule startup after mounting the UI.
    const startup = setTimeout(() => { void refreshAll() }, 0)

    const timer = setInterval(() => {
      fetchOrders()
    }, 3000)

    return () => {
      clearTimeout(startup)
      clearInterval(timer)
      ordersRequestId.current += 1
    }
    // These loaders only use the stable client, refs and React state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (orderToDelete && !dialog.open) dialog.showModal()
    if (!orderToDelete && dialog.open) dialog.close()
  }, [orderToDelete])

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function handleCategoryChange(e) {
    const { name, value } = e.target
    setCategoryForm((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  function resetForm() {
    setForm(emptyForm)
    setEditingId(null)
    setMessage('')
  }

  function resetCategoryForm() {
    setCategoryForm(emptyCategoryForm)
    setEditingCategoryId(null)
    setMessage('')
  }

  function handleEdit(item) {
    setEditingId(item.id)
    setForm({
      name: item.name ?? '',
      price: item.price ?? '',
      note: item.note ?? '',
      category: item.category ?? '',
      image_url: item.image_url ?? '',
      is_available: item.is_available ?? true,
      allow_custom_note: item.allow_custom_note ?? true,
    })
    setMessage('已載入商品，可直接修改')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleEditCategory(category) {
    setEditingCategoryId(category.id)
    setCategoryForm({
      name: category.name ?? '',
      sort_order: category.sort_order ?? '',
    })
    setMessage('已載入分類，可直接修改')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage('')

    if (!form.name.trim()) {
      setMessage('請輸入商品名稱')
      return
    }

    if (!form.price || Number(form.price) <= 0) {
      setMessage('請輸入正確價格')
      return
    }

    setLoading(true)

    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      note: form.note.trim(),
      category: form.category.trim(),
      image_url: form.image_url.trim(),
      is_available: form.is_available,
      allow_custom_note: form.allow_custom_note,
    }

    let error

    if (editingId) {
      const result = await supabase.from('menu_items').update(payload).eq('id', editingId)
      error = result.error
    } else {
      const result = await supabase.from('menu_items').insert([payload])
      error = result.error
    }

    setLoading(false)

    if (error) {
      setMessage((editingId ? '更新失敗：' : '新增失敗：') + error.message)
      return
    }

    if (payload.category) {
      await ensureCategoryExists(payload.category)
    }

    setMessage(editingId ? '更新成功' : '新增成功')
    resetForm()
    await refreshAll()
  }

  async function ensureCategoryExists(categoryName) {
    const trimmedName = categoryName.trim()
    if (!trimmedName) return

    const exists = menuCategories.some((category) => category.name === trimmedName)
    if (exists) return

    const maxOrder =
      menuCategories.length === 0
        ? 0
        : Math.max(...menuCategories.map((category) => Number(category.sort_order) || 0))

    await supabase.from('menu_categories').insert([
      {
        name: trimmedName,
        sort_order: maxOrder + 1,
      },
    ])
  }

  async function handleCategorySubmit(e) {
    e.preventDefault()
    setMessage('')

    if (!categoryForm.name.trim()) {
      setMessage('請輸入分類名稱')
      return
    }

    if (categoryForm.sort_order === '' || Number.isNaN(Number(categoryForm.sort_order))) {
      setMessage('請輸入分類順序數字')
      return
    }

    setCategoryLoading(true)

    const payload = {
      name: categoryForm.name.trim(),
      sort_order: Number(categoryForm.sort_order),
    }

    let error

    if (editingCategoryId) {
      const result = await supabase
        .from('menu_categories')
        .update(payload)
        .eq('id', editingCategoryId)
      error = result.error
    } else {
      const result = await supabase.from('menu_categories').insert([payload])
      error = result.error
    }

    setCategoryLoading(false)

    if (error) {
      setMessage((editingCategoryId ? '更新分類失敗：' : '新增分類失敗：') + error.message)
      return
    }

    setMessage(editingCategoryId ? '更新分類成功' : '新增分類成功')
    resetCategoryForm()
    await fetchMenuCategories()
  }

  async function handleDelete(id) {
    const confirmed = window.confirm('確定要刪除這個商品嗎？商品的選項也會一起刪掉。')
    if (!confirmed) return

    const { error } = await supabase.from('menu_items').delete().eq('id', id)

    if (error) {
      setMessage('刪除失敗：' + error.message)
      return
    }

    if (editingId === id) resetForm()

    setMessage('刪除成功')
    await refreshAll()
  }

  async function handleDeleteCategory(category) {
    const usedCount = menuItems.filter((item) => item.category === category.name).length

    const confirmed = window.confirm(
      usedCount > 0
        ? `確定要刪除「${category.name}」分類嗎？目前有 ${usedCount} 個商品使用這個分類。刪除分類不會刪除商品，但客戶端會把這類商品排到最後。`
        : `確定要刪除「${category.name}」分類嗎？`
    )

    if (!confirmed) return

    const { error } = await supabase.from('menu_categories').delete().eq('id', category.id)

    if (error) {
      setMessage('刪除分類失敗：' + error.message)
      return
    }

    if (editingCategoryId === category.id) resetCategoryForm()

    setMessage('刪除分類成功')
    await fetchMenuCategories()
  }

  function handleOptionInputChange(menuItemId, field, value) {
    setOptionForms((prev) => ({
      ...prev,
      [menuItemId]: {
        ...(prev[menuItemId] || emptyOptionForm),
        [field]: value,
      },
    }))
  }

  async function handleAddOption(menuItemId) {
    const current = optionForms[menuItemId] || emptyOptionForm

    if (!current.label?.trim()) {
      setMessage('請先輸入選項名稱')
      return
    }

    setOptionLoadingId(menuItemId)

    const { error } = await supabase.from('menu_item_options').insert([
      {
        menu_item_id: menuItemId,
        label: current.label.trim(),
        price_delta: current.price_delta === '' ? 0 : Number(current.price_delta),
      },
    ])

    setOptionLoadingId(null)

    if (error) {
      setMessage('新增選項失敗：' + error.message)
      return
    }

    setOptionForms((prev) => ({
      ...prev,
      [menuItemId]: emptyOptionForm,
    }))

    setMessage('新增選項成功')
    await fetchOptions()
  }

  async function handleDeleteOption(optionId) {
    const confirmed = window.confirm('確定要刪除這個選項嗎？')
    if (!confirmed) return

    const { error } = await supabase.from('menu_item_options').delete().eq('id', optionId)

    if (error) {
      setMessage('刪除選項失敗：' + error.message)
      return
    }

    setMessage('刪除選項成功')
    await fetchOptions()
  }

  async function handleAcceptOrder(orderId) {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'accepted' })
      .eq('id', orderId)

    if (error) {
      setMessage('接單失敗：' + error.message)
      return
    }

    setMessage('接單成功')
    await fetchOrders()
  }

  function handleDeleteOrder(order) {
    if (deleteInFlight.current) return
    setDeleteError('')
    setOrderMessage('')
    setOrderToDelete(order)
  }

  function cancelDeleteOrder() {
    if (!deleteInFlight.current) setOrderToDelete(null)
  }

  async function confirmDeleteOrder() {
    if (!orderToDelete || deleteInFlight.current) return
    const orderId = orderToDelete.id
    deleteInFlight.current = true
    setDeletingOrderId(orderId)
    setDeleteError('')
    try {
      await deleteOrder(supabase, orderId)
      // Ignore any poll started before this deletion, so it cannot resurrect the card.
      ordersRequestId.current += 1
      setOrders((previous) => previous.filter((order) => String(order.id) !== String(orderId)))
      setOrderItemsMap((previous) => {
        const next = { ...previous }
        delete next[orderId]
        return next
      })
      setOrderMessage(`已刪除訂單 #${orderId} 及其明細。`)
      setOrderToDelete(null)
      void fetchOrders()
    } catch (error) {
      const detail = error instanceof TypeError
        ? '連線中斷，無法確認刪除結果。請重新整理訂單後再試。'
        : error.message || '無法確認刪除結果，請重新整理後再試。'
      setDeleteError('刪除訂單失敗：' + detail)
    } finally {
      deleteInFlight.current = false
      setDeletingOrderId(null)
    }
  }

  const categoryOrderMap = useMemo(() => {
    const map = {}
    menuCategories.forEach((category) => {
      map[category.name] = Number(category.sort_order) || 999
    })
    return map
  }, [menuCategories])

  const sortedMenuItems = useMemo(() => {
    return [...menuItems].sort((a, b) => {
      const orderA = categoryOrderMap[a.category] ?? 9999
      const orderB = categoryOrderMap[b.category] ?? 9999

      if (orderA !== orderB) return orderA - orderB
      return a.id - b.id
    })
  }, [menuItems, categoryOrderMap])

  const pendingOrders = useMemo(
    () => orders.filter((order) => order.status === 'pending'),
    [orders]
  )

  const acceptedOrders = useMemo(
    () => orders.filter((order) => order.status === 'accepted'),
    [orders]
  )

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.hero}>
  <h1 style={styles.pageTitle}>蝦米攏烏｜商家管理後台</h1>
  <p style={styles.pageSubtitle}>
    這裡同時管理菜單、分類順序與接單。顧客端會依照分類管理設定的順序顯示菜單。
  </p>
</div>

        <div style={styles.layout}>
          <div style={styles.leftColumn}>
            <section style={styles.card}>
              <h2 style={styles.title}>商品管理</h2>

              <form onSubmit={handleSubmit} style={styles.form}>
                <div style={styles.field}>
                  <label style={styles.label}>商品名稱</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="例如：滷肉飯"
                    style={styles.input}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>價格</label>
                  <input
                    name="price"
                    type="number"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="例如：80"
                    style={styles.input}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>分類</label>
                  <input
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    placeholder="例如：主餐、飲料、炸物"
                    style={styles.input}
                    list="category-options"
                  />
                  <datalist id="category-options">
                    {menuCategories.map((category) => (
                      <option key={category.id} value={category.name} />
                    ))}
                  </datalist>
                  <div style={styles.hintText}>
                    可直接輸入新分類；新增商品後，系統會自動把新分類加入分類管理。
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>圖片網址</label>
                  <input
                    name="image_url"
                    value={form.image_url}
                    onChange={handleChange}
                    placeholder="貼上商品圖片網址"
                    style={styles.input}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>商品說明</label>
                  <input
                    name="note"
                    value={form.note}
                    onChange={handleChange}
                    placeholder="例如：招牌必點、每日限量"
                    style={styles.input}
                  />
                </div>

                <label style={styles.checkRow}>
                  <input
                    name="is_available"
                    type="checkbox"
                    checked={form.is_available}
                    onChange={handleChange}
                  />
                  <span>上架中</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    name="allow_custom_note"
                    type="checkbox"
                    checked={form.allow_custom_note}
                    onChange={handleChange}
                  />
                  <span>允許顧客自行輸入備註</span>
                </label>

                <div style={styles.buttonRow}>
                  <button type="submit" style={styles.primaryButton} disabled={loading}>
                    {loading ? '處理中...' : editingId ? '更新商品' : '新增商品'}
                  </button>

                  <button type="button" style={styles.secondaryButton} onClick={resetForm}>
                    清空
                  </button>
                </div>
              </form>

              {message ? <p style={styles.message}>{message}</p> : null}
            </section>

            <section style={styles.card}>
              <h2 style={styles.title}>分類管理</h2>
              <p style={styles.sectionDescription}>
                數字越小越前面。修改後，客戶端重新整理就會照新的順序顯示。
              </p>

              <form onSubmit={handleCategorySubmit} style={styles.form}>
                <div style={styles.field}>
                  <label style={styles.label}>分類名稱</label>
                  <input
                    name="name"
                    value={categoryForm.name}
                    onChange={handleCategoryChange}
                    placeholder="例如：主餐"
                    style={styles.input}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>排序數字</label>
                  <input
                    name="sort_order"
                    type="number"
                    value={categoryForm.sort_order}
                    onChange={handleCategoryChange}
                    placeholder="例如：1"
                    style={styles.input}
                  />
                </div>

                <div style={styles.buttonRow}>
                  <button type="submit" style={styles.primaryButton} disabled={categoryLoading}>
                    {categoryLoading
                      ? '處理中...'
                      : editingCategoryId
                      ? '更新分類'
                      : '新增分類'}
                  </button>

                  <button type="button" style={styles.secondaryButton} onClick={resetCategoryForm}>
                    清空
                  </button>
                </div>
              </form>

              <div style={styles.categoryList}>
                {menuCategories.length === 0 ? (
                  <p style={styles.empty}>目前還沒有分類</p>
                ) : (
                  menuCategories.map((category) => {
                    const usedCount = menuItems.filter((item) => item.category === category.name)
                      .length

                    return (
                      <div key={category.id} style={styles.categoryItem}>
                        <div>
                          <div style={styles.categoryName}>{category.name}</div>
                          <div style={styles.categoryMeta}>
                            排序：{category.sort_order}｜商品數：{usedCount}
                          </div>
                        </div>

                        <div style={styles.categoryActionRow}>
                          <button
                            style={styles.editButton}
                            onClick={() => handleEditCategory(category)}
                          >
                            編輯
                          </button>
                          <button
                            style={styles.deleteButton}
                            onClick={() => handleDeleteCategory(category)}
                          >
                            刪除
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          </div>

          <div style={styles.rightColumn}>
            <section style={styles.card}>
              <h2 style={styles.title}>目前菜單與選項</h2>

              {sortedMenuItems.length === 0 ? (
                <p style={styles.empty}>目前還沒有商品，先在左邊新增第一道吧。</p>
              ) : (
                <div style={styles.menuList}>
                  {sortedMenuItems.map((item) => {
                    const options = optionsMap[item.id] || []
                    const optionForm = optionForms[item.id] || emptyOptionForm
                    const isCategoryKnown = Boolean(categoryOrderMap[item.category])

                    return (
                      <div key={item.id} style={styles.menuCard}>
                        <div style={styles.menuTop}>
                          <div style={styles.menuInfo}>
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.name} style={styles.image} />
                            ) : (
                              <div style={styles.imagePlaceholder}>無圖片</div>
                            )}

                            <div style={{ flex: 1 }}>
                              <div style={styles.itemHeader}>
                                <div style={styles.itemName}>{item.name}</div>
                                <div style={styles.itemPrice}>NT$ {item.price}</div>
                              </div>

                              <div style={styles.badgeRow}>
                                <span
                                  style={{
                                    ...styles.badge,
                                    ...(!isCategoryKnown && item.category
                                      ? styles.badgeWarning
                                      : {}),
                                  }}
                                >
                                  {item.category || '未分類'}
                                </span>
                                <span
                                  style={{
                                    ...styles.badge,
                                    ...(item.is_available
                                      ? styles.badgeAvailable
                                      : styles.badgeUnavailable),
                                  }}
                                >
                                  {item.is_available ? '上架中' : '已下架'}
                                </span>
                                <span style={styles.badge}>
                                  {item.allow_custom_note ? '可填備註' : '不可填備註'}
                                </span>
                              </div>

                              {!isCategoryKnown && item.category ? (
                                <div style={styles.warningText}>
                                  這個分類尚未在分類管理中設定，客戶端會排在最後。
                                </div>
                              ) : null}

                              <div style={styles.noteText}>{item.note || '無商品說明'}</div>
                            </div>
                          </div>

                          <div style={styles.actionRow}>
                            <button style={styles.editButton} onClick={() => handleEdit(item)}>
                              編輯
                            </button>
                            <button
                              style={styles.deleteButton}
                              onClick={() => handleDelete(item.id)}
                            >
                              刪除
                            </button>
                          </div>
                        </div>

                        <div style={styles.optionBlock}>
                          <div style={styles.optionTitle}>勾選式選項</div>

                          {options.length === 0 ? (
                            <div style={styles.emptyOption}>目前沒有選項</div>
                          ) : (
                            <div style={styles.optionList}>
                              {options.map((option) => (
                                <div key={option.id} style={styles.optionItem}>
                                  <div>
                                    <div style={styles.optionLabel}>{option.label}</div>
                                    <div style={styles.optionPrice}>
                                      {option.price_delta > 0
                                        ? `+ NT$ ${option.price_delta}`
                                        : option.price_delta < 0
                                        ? `- NT$ ${Math.abs(option.price_delta)}`
                                        : '不加價'}
                                    </div>
                                  </div>

                                  <button
                                    style={styles.optionDeleteButton}
                                    onClick={() => handleDeleteOption(option.id)}
                                  >
                                    刪除選項
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={styles.addOptionRow}>
                            <input
                              value={optionForm.label}
                              onChange={(e) =>
                                handleOptionInputChange(item.id, 'label', e.target.value)
                              }
                              placeholder="選項名稱，例如：不要香菜"
                              style={styles.input}
                            />
                            <input
                              type="number"
                              value={optionForm.price_delta}
                              onChange={(e) =>
                                handleOptionInputChange(item.id, 'price_delta', e.target.value)
                              }
                              placeholder="加價，例如：15"
                              style={styles.input}
                            />
                            <button
                              style={styles.primaryButton}
                              onClick={() => handleAddOption(item.id)}
                              disabled={optionLoadingId === item.id}
                            >
                              {optionLoadingId === item.id ? '新增中...' : '新增選項'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section style={styles.card}>
              <h2 style={styles.title}>接單區</h2>
              {orderMessage ? <p role="status" style={styles.message}>{orderMessage}</p> : null}

              <div style={styles.orderSection}>
                <h3 style={styles.orderTitle}>待接訂單</h3>
                {pendingOrders.length === 0 ? (
                  <p style={styles.empty}>目前沒有新訂單</p>
                ) : (
                  <div style={styles.orderList}>
                    {pendingOrders.map((order) => {
                      const items = orderItemsMap[order.id] || []

                      return (
                        <div key={order.id} style={styles.orderCard}>
                          <div style={styles.orderHeader}>
                            <div>
                              <div style={styles.orderNumber}>訂單 #{order.id}</div>
                              <div style={styles.orderMeta}>
                                桌號：{order.table_number}｜付款：{order.payment_method}
                              </div>
                            </div>
                            <div style={{ ...styles.badge, ...styles.badgePending }}>待接單</div>
                          </div>

                          <div style={styles.orderItems}>
                            {items.length === 0 ? (
                              <div style={styles.emptyOption}>目前沒有訂單明細</div>
                            ) : (
                              items.map((item) => (
                                <div key={item.id} style={styles.orderItemRow}>
                                  <div>
                                    <div style={styles.orderItemName}>
                                      {item.item_name} × {item.quantity}
                                    </div>
                                    <div style={styles.orderItemMeta}>
                                      單價 NT$ {item.unit_price}
                                    </div>
                                    {Array.isArray(item.selected_options) &&
                                    item.selected_options.length > 0 ? (
                                      <div style={styles.orderItemMeta}>
                                        選項：
                                        {item.selected_options
                                          .map((opt) =>
                                            typeof opt === 'string'
                                              ? opt
                                              : opt.label || JSON.stringify(opt)
                                          )
                                          .join('、')}
                                      </div>
                                    ) : null}
                                    {item.customer_note ? (
                                      <div style={styles.orderItemMeta}>
                                        備註：{item.customer_note}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          <div style={styles.orderFooter}>
                            <div style={styles.orderTotal}>總金額 NT$ {order.total_amount}</div>
                            <div style={styles.orderActionRow}>
                              <button
                                style={styles.acceptButton}
                                onClick={() => handleAcceptOrder(order.id)}
                                disabled={deletingOrderId !== null}
                              >
                                接單
                              </button>
                              <button
                                type="button"
                                style={styles.deleteButton}
                                onClick={() => handleDeleteOrder(order)}
                                disabled={deletingOrderId !== null}
                              >
                                刪除訂單
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={styles.orderSection}>
                <h3 style={styles.orderTitle}>已接訂單</h3>
                {acceptedOrders.length === 0 ? (
                  <p style={styles.empty}>目前沒有已接訂單</p>
                ) : (
                  <div style={styles.orderList}>
                    {acceptedOrders.map((order) => {
                      const items = orderItemsMap[order.id] || []

                      return (
                        <div key={order.id} style={styles.orderCard}>
                          <div style={styles.orderHeader}>
                            <div>
                              <div style={styles.orderNumber}>訂單 #{order.id}</div>
                              <div style={styles.orderMeta}>
                                桌號：{order.table_number}｜付款：{order.payment_method}
                              </div>
                            </div>
                            <div style={{ ...styles.badge, ...styles.badgeAvailable }}>
                              已接單
                            </div>
                          </div>

                          <div style={styles.orderItems}>
                            {items.map((item) => (
                              <div key={item.id} style={styles.orderItemRow}>
                                <div>
                                  <div style={styles.orderItemName}>
                                    {item.item_name} × {item.quantity}
                                  </div>
                                  <div style={styles.orderItemMeta}>
                                    單價 NT$ {item.unit_price}
                                  </div>
                                  {Array.isArray(item.selected_options) &&
                                  item.selected_options.length > 0 ? (
                                    <div style={styles.orderItemMeta}>
                                      選項：
                                      {item.selected_options
                                        .map((opt) =>
                                          typeof opt === 'string'
                                            ? opt
                                            : opt.label || JSON.stringify(opt)
                                        )
                                        .join('、')}
                                    </div>
                                  ) : null}
                                  {item.customer_note ? (
                                    <div style={styles.orderItemMeta}>
                                      備註：{item.customer_note}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div style={styles.orderFooter}>
                            <div style={styles.orderTotal}>總金額 NT$ {order.total_amount}</div>
                            <button
                              type="button"
                              style={styles.deleteButton}
                              onClick={() => handleDeleteOrder(order)}
                              disabled={deletingOrderId !== null}
                            >
                              刪除訂單
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-order-title"
        aria-describedby="delete-order-description"
        aria-busy={deletingOrderId !== null}
        onCancel={(event) => { event.preventDefault(); cancelDeleteOrder() }}
        style={styles.deleteDialog}
      >
        <h2 id="delete-order-title" style={styles.title}>確認刪除訂單</h2>
        {orderToDelete ? (
          <p id="delete-order-description">
            訂單 #{orderToDelete.id}｜桌號：{orderToDelete.table_number}｜總金額 NT$ {orderToDelete.total_amount}
            <br />這筆訂單及其明細將永久刪除，無法復原。
          </p>
        ) : null}
        {deleteError ? <p role="alert" style={{ color: '#a12622' }}>{deleteError}</p> : null}
        <div style={styles.orderActionRow}>
          <button type="button" autoFocus onClick={cancelDeleteOrder} disabled={deletingOrderId !== null} style={styles.secondaryButton}>
            取消，保留訂單
          </button>
          <button type="button" onClick={confirmDeleteOrder} disabled={deletingOrderId !== null} style={styles.deleteButton}>
            {deletingOrderId !== null ? '刪除中…' : '確認永久刪除'}
          </button>
        </div>
      </dialog>
    </div>
  )
}

const styles = {
  deleteDialog: {
    width: 'min(520px, calc(100vw - 48px))',
    boxSizing: 'border-box',
    border: '2px solid #384C65',
    borderRadius: 16,
    padding: 24,
    lineHeight: 1.8,
    color: adminColors.primary,
    background: adminColors.light,
    boxShadow: '0 12px 80px rgba(0,0,0,0.35)',
  },
  page: {
    minHeight: '100vh',
    background: adminColors.light,
    padding: '24px 16px 40px',
    fontFamily: '"Noto Serif TC","PMingLiU","MingLiU","Songti TC",serif',
    color: adminColors.primary,
  },
  container: {
    maxWidth: '1280px',
    margin: '0 auto',
  },
  hero: {
    marginBottom: 20,
  },
  pageTitle: {
    margin: 0,
    fontSize: '34px',
    lineHeight: 1.2,
    color: adminColors.primary,
  },
  pageSubtitle: {
    marginTop: 10,
    fontSize: '17px',
    color: adminColors.dark,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
    gap: 20,
  },
  leftColumn: {
    display: 'grid',
    gap: 20,
    alignContent: 'start',
  },
  rightColumn: {
    display: 'grid',
    gap: 20,
  },
  card: {
    background: '#ffffff',
    borderRadius: 22,
    padding: 24,
    boxShadow: '0 10px 30px rgba(56,76,101,0.10)',
    border: `1px solid ${adminColors.soft}`,
  },
  title: {
    marginTop: 0,
    marginBottom: 18,
    fontSize: '28px',
    color: adminColors.primary,
  },
  sectionDescription: {
    marginTop: -8,
    marginBottom: 18,
    fontSize: '16px',
    color: adminColors.dark,
    lineHeight: 1.7,
  },
  form: {
    display: 'grid',
    gap: 14,
  },
  field: {
    display: 'grid',
    gap: 8,
  },
  label: {
    fontSize: '18px',
    fontWeight: 700,
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 14,
    border: `1px solid ${adminColors.soft}`,
    fontSize: '17px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    background: '#fff',
    color: adminColors.primary,
  },
  hintText: {
    fontSize: '14px',
    color: adminColors.dark,
    lineHeight: 1.6,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: '17px',
    fontWeight: 700,
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 8,
  },
  primaryButton: {
    border: 'none',
    borderRadius: 14,
    padding: '14px 18px',
    background: adminColors.primary,
    color: '#fff',
    fontSize: '17px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  secondaryButton: {
    border: `1px solid ${adminColors.mid}`,
    borderRadius: 14,
    padding: '14px 18px',
    background: '#fff',
    color: adminColors.primary,
    fontSize: '17px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  message: {
    marginTop: 16,
    fontSize: '16px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  empty: {
    fontSize: '17px',
    color: adminColors.dark,
  },
  categoryList: {
    display: 'grid',
    gap: 12,
    marginTop: 18,
  },
  categoryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    border: `1px solid ${adminColors.soft}`,
    background: adminColors.light,
  },
  categoryName: {
    fontSize: '19px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  categoryMeta: {
    marginTop: 5,
    fontSize: '15px',
    color: adminColors.dark,
  },
  categoryActionRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  menuList: {
    display: 'grid',
    gap: 16,
  },
  menuCard: {
    border: `1px solid ${adminColors.soft}`,
    borderRadius: 18,
    padding: 16,
    background: adminColors.light,
  },
  menuTop: {
    display: 'grid',
    gap: 14,
  },
  menuInfo: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
  },
  image: {
    width: 110,
    height: 110,
    objectFit: 'cover',
    borderRadius: 14,
    flexShrink: 0,
    border: `1px solid ${adminColors.soft}`,
    background: '#fff',
  },
  imagePlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 14,
    flexShrink: 0,
    border: `1px dashed ${adminColors.mid}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    color: adminColors.dark,
    fontSize: '16px',
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  itemName: {
    fontSize: '24px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  itemPrice: {
    fontSize: '20px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  badgeRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  badge: {
    padding: '6px 10px',
    borderRadius: 999,
    background: '#ecebe7',
    color: adminColors.primary,
    fontSize: '14px',
    fontWeight: 700,
  },
  badgeAvailable: {
    background: '#e5efe8',
    color: '#22613d',
  },
  badgeUnavailable: {
    background: '#f8e7e7',
    color: '#9e3030',
  },
  badgePending: {
    background: '#f5ead8',
    color: '#8a5a1e',
  },
  badgeWarning: {
    background: '#fff0d8',
    color: '#9b5c00',
  },
  warningText: {
    marginTop: 8,
    fontSize: '15px',
    color: '#9b5c00',
    lineHeight: 1.6,
    fontWeight: 700,
  },
  noteText: {
    marginTop: 10,
    fontSize: '16px',
    color: adminColors.dark,
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  editButton: {
    border: 'none',
    borderRadius: 12,
    padding: '12px 16px',
    background: adminColors.primary,
    color: '#fff',
    fontSize: '16px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  deleteButton: {
    border: 'none',
    borderRadius: 12,
    padding: '12px 16px',
    background: '#9e4c4c',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  optionBlock: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: `1px solid ${adminColors.soft}`,
  },
  optionTitle: {
    fontSize: '20px',
    fontWeight: 700,
    marginBottom: 12,
    color: adminColors.primary,
  },
  emptyOption: {
    color: adminColors.dark,
    fontSize: '16px',
    marginBottom: 12,
  },
  optionList: {
    display: 'grid',
    gap: 10,
    marginBottom: 14,
  },
  optionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'center',
    background: '#fff',
    border: `1px solid ${adminColors.soft}`,
    borderRadius: 14,
    padding: '12px 14px',
  },
  optionLabel: {
    fontSize: '17px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  optionPrice: {
    fontSize: '15px',
    color: adminColors.dark,
    marginTop: 4,
  },
  optionDeleteButton: {
    border: 'none',
    borderRadius: 10,
    padding: '10px 12px',
    background: '#9e4c4c',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
    flexShrink: 0,
  },
  addOptionRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.5fr) minmax(120px, 0.7fr) auto',
    gap: 10,
    alignItems: 'center',
  },
  orderSection: {
    marginTop: 8,
  },
  orderTitle: {
    fontSize: '22px',
    marginTop: 0,
    marginBottom: 14,
    color: adminColors.primary,
  },
  orderList: {
    display: 'grid',
    gap: 14,
  },
  orderCard: {
    border: `1px solid ${adminColors.soft}`,
    borderRadius: 18,
    padding: 16,
    background: adminColors.light,
  },
  orderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderNumber: {
    fontSize: '22px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  orderMeta: {
    marginTop: 6,
    fontSize: '16px',
    color: adminColors.dark,
  },
  orderItems: {
    display: 'grid',
    gap: 10,
  },
  orderItemRow: {
    background: '#fff',
    border: `1px solid ${adminColors.soft}`,
    borderRadius: 14,
    padding: '12px 14px',
  },
  orderItemName: {
    fontSize: '17px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  orderItemMeta: {
    marginTop: 4,
    fontSize: '15px',
    color: adminColors.dark,
  },
  orderFooter: {
    marginTop: 14,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  orderTotal: {
    fontSize: '20px',
    fontWeight: 700,
    color: adminColors.primary,
  },
  orderActionRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  acceptButton: {
    border: 'none',
    borderRadius: 12,
    padding: '12px 16px',
    background: '#4d7d57',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
}

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(max-width: 900px)')
  if (media.matches) {
    styles.layout.gridTemplateColumns = '1fr'
    styles.addOptionRow.gridTemplateColumns = '1fr'
    styles.categoryItem.flexDirection = 'column'
    styles.categoryItem.alignItems = 'flex-start'
    styles.categoryActionRow.justifyContent = 'flex-start'
  }
}
