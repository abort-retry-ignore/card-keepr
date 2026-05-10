<script>
  import { onMount, tick } from 'svelte'
  import QRCode from 'qrcode'
  import JsBarcode from 'jsbarcode'

  const categories = ['All', 'Discount', 'Membership', 'Library', 'ID', 'Credit Card', 'Transport', 'Health', 'Other']
  const barcodeFormats = [
    { value: 'CODE128', label: 'Code 128' },
    { value: 'CODE39', label: 'Code 39' },
    { value: 'CODABAR', label: 'Codabar' },
    { value: 'EAN13', label: 'EAN-13' },
    { value: 'EAN8', label: 'EAN-8' },
    { value: 'UPC', label: 'UPC' },
    { value: 'ITF', label: 'Interleaved 2 of 5 (ITF)' },
    { value: 'ITF14', label: 'ITF-14' }
  ]
  const detectorFormatMap = {
    barcodeValue: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'],
    qrValue: ['qr_code']
  }
  const offlineDbName = 'card-keepr-offline'
  const offlineDbVersion = 1
  const offlineCardsStore = 'cards-by-user'
  const offlineUserKey = 'card-keepr-offline-user'

  const defaultCard = () => ({
    title: '',
    issuer: '',
    category: 'Discount',
    cardholderName: '',
    identifier: '',
    barcodeValue: '',
    barcodeFormat: 'CODE128',
    qrValue: '',
    notes: '',
    tagsText: '',
    color: '#7c3aed',
    favorite: false,
    frontImageDataUrl: '',
    backImageDataUrl: '',
    expiryDate: '',
    securityCode: ''
  })

  let sessionLoading = true
  let sessionChecked = false
  let authenticated = false
  let username = ''
  let isAdmin = false
  let authTab = 'login'
  let loginUsername = ''
  let loginPassword = ''
  let loginError = ''
  let registerUsername = ''
  let registerPassword = ''
  let registerPasswordConfirm = ''
  let registerError = ''
  let registering = false
  let cards = []
  let selectedId = null
  let editorId = null
  let mode = 'wallet'
  let settings = {
    showWalletFilters: false,
    aiEndpoint: 'https://api.openai.com/v1',
    aiModel: 'gpt-4o',
    aiApiKey: ''
  }
  let form = defaultCard()
  let search = ''
  let activeCategory = 'All'
  let loadingCards = false
  let saving = false
  let deleting = false
  let searchOpen = false
  let installPrompt = null
  let installReady = false
  let splashVisible = true
  let theme = 'light'
  let flash = null
  let qrPreview = ''
  let barcodeError = ''
  let barcodeSvg
  let selectedBarcodeSvg
  let zoomedBarcodeSvg
  let scannerOpen = false
  let scannerError = ''
  let scannerTarget = 'barcodeValue'
  let scannerStatus = 'Point the camera at a code'
  let extracting = false
  let videoEl
  let cameraStream = null
  let scannerTimer = null
  let frontInput
  let backInput
  let userImportInput
  let adminRestoreInput
  let focusedCardEl
  let walletFace = 'front'
  let backImageSide = 'back'
  let zoomedCode = null
  let zoomedBarcodeRotated = false
  let changePwCurrent = ''
  let changePwNew = ''
  let changePwConfirm = ''
  let changePwError = ''
  let changePwSaving = false
  let userExporting = false
  let userImporting = false
  let adminSqlDownloading = false
  let adminSqlRestoring = false
  let renderCodesToken = 0

  $: themeLabel = theme === 'light' ? 'Dark mode' : 'Light mode'
  $: themeIcon = theme === 'dark' ? '◐' : '◑'
  $: isEditMode = mode === 'edit'
  $: isSettingsMode = mode === 'settings'

  $: totalCards = cards.length
  $: photoCards = cards.filter(card => card.frontImageDataUrl || card.backImageDataUrl).length
  $: codedCards = cards.filter(card => card.barcodeValue || card.qrValue).length
  $: selectedCard = cards.find(card => card.id === selectedId) || null
  $: filteredCards = cards.filter(card => {
    const matchesCategory = activeCategory === 'All' || card.category === activeCategory
    const haystack = [card.title, card.issuer, card.identifier, ...(card.tags || []), card.cardholderName]
      .join(' ')
      .toLowerCase()
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
    return matchesCategory && matchesSearch
  })
  $: stackCards = filteredCards.filter(card => card.id !== selectedId)

  $: renderCodes(form.barcodeValue, form.barcodeFormat, form.qrValue)

  function isNetworkError(error) {
    return error instanceof TypeError || error?.message === 'Failed to fetch' || error?.message === 'Load failed'
  }

  function setOfflineUser(nextUsername) {
    if (!nextUsername) return
    localStorage.setItem(offlineUserKey, nextUsername)
  }

  function clearOfflineUser() {
    localStorage.removeItem(offlineUserKey)
  }

  function openOfflineDb() {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      return Promise.resolve(null)
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(offlineDbName, offlineDbVersion)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(offlineCardsStore)) {
          database.createObjectStore(offlineCardsStore, { keyPath: 'username' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function readOfflineCards(cacheUsername) {
    if (!cacheUsername) return []

    const database = await openOfflineDb()
    if (!database) return []

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(offlineCardsStore, 'readonly')
      const store = transaction.objectStore(offlineCardsStore)
      const request = store.get(cacheUsername)

      transaction.oncomplete = () => database.close()
      transaction.onerror = () => reject(transaction.error)
      request.onsuccess = () => resolve(request.result?.cards || [])
      request.onerror = () => reject(request.error)
    })
  }

  async function writeOfflineCards(cacheUsername, nextCards) {
    if (!cacheUsername) return

    const database = await openOfflineDb()
    if (!database) return

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(offlineCardsStore, 'readwrite')
      const store = transaction.objectStore(offlineCardsStore)
      store.put({
        username: cacheUsername,
        cards: nextCards,
        updatedAt: new Date().toISOString()
      })

      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async function deleteOfflineCards(cacheUsername) {
    if (!cacheUsername) return

    const database = await openOfflineDb()
    if (!database) return

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(offlineCardsStore, 'readwrite')
      const store = transaction.objectStore(offlineCardsStore)
      store.delete(cacheUsername)

      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    })
  }

  function applyCards(nextCards) {
    cards = nextCards

    if (selectedId) {
      const current = nextCards.find(card => card.id === selectedId)
      if (current) {
        selectCard(current)
      } else if (nextCards[0]) {
        selectCard(nextCards[0])
      } else {
        selectedId = null
        form = defaultCard()
      }
    } else if (nextCards[0]) {
      selectCard(nextCards[0])
    } else {
      selectedId = null
      form = defaultCard()
    }
  }

  function showFlash(message, tone = 'ok') {
    flash = { message, tone }
    window.clearTimeout(showFlash.timer)
    showFlash.timer = window.setTimeout(() => {
      flash = null
    }, 2600)
  }

  function applyTheme(nextTheme) {
    theme = nextTheme
    document.documentElement.setAttribute('data-theme', nextTheme)
    const themeColor = nextTheme === 'light' ? '#f0f2f5' : '#0a0a0f'
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) themeMeta.setAttribute('content', themeColor)
    localStorage.setItem('card-keepr-theme', nextTheme)
  }

  function toggleTheme() {
    applyTheme(theme === 'light' ? 'dark' : 'light')
  }

  function toggleSearch() {
    if (searchOpen && !search.trim()) {
      searchOpen = false
      return
    }

    searchOpen = true
  }

  function openSettings() {
    mode = 'settings'
  }

  function closeSettings() {
    mode = 'wallet'
  }

  function updateSetting(key, value) {
    settings = { ...settings, [key]: value }
    localStorage.setItem('card-keepr-settings', JSON.stringify({ ...settings, [key]: value }))
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      credentials: 'same-origin',
      ...options
    })

    if (response.status === 401) {
      authenticated = false
      username = ''
      throw new Error('Authentication required')
    }

    if (!response.ok) {
      let message = 'Request failed'
      try {
        const payload = await response.json()
        message = payload.error || message
      } catch {
        message = response.statusText || message
      }
      throw new Error(message)
    }

    return response.json()
  }

  async function apiBlob(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options
    })

    if (response.status === 401) {
      authenticated = false
      username = ''
      isAdmin = false
      throw new Error('Authentication required')
    }

    if (!response.ok) {
      let message = 'Request failed'
      try {
        const payload = await response.json()
        message = payload.error || message
      } catch {
        message = response.statusText || message
      }
      throw new Error(message)
    }

    return {
      blob: await response.blob(),
      filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || ''
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function fetchSession() {
    sessionLoading = true
    try {
      const payload = await api('/api/session')
      authenticated = payload.authenticated
      username = payload.username || ''
      isAdmin = Boolean(payload.isAdmin)
      if (authenticated) {
        setOfflineUser(username)
        await fetchCards()
      }
    } catch (error) {
      if (isNetworkError(error)) {
        const cachedUsername = localStorage.getItem(offlineUserKey) || ''
        const offlineCards = await readOfflineCards(cachedUsername)

        if (cachedUsername) {
          authenticated = true
          username = cachedUsername
          applyCards(offlineCards)
          showFlash('Offline mode: showing cached cards')
        } else {
          authenticated = false
          isAdmin = false
        }
      } else {
        authenticated = false
        isAdmin = false
      }
    } finally {
      sessionLoading = false
      sessionChecked = true
      if (authenticated) {
        await tick()
        await renderCodes()
      }
    }
  }

  async function hydrateCachedSession() {
    const cachedUsername = localStorage.getItem(offlineUserKey) || ''
    if (!cachedUsername) return false

    const offlineCards = await readOfflineCards(cachedUsername)
    authenticated = true
    username = cachedUsername
    isAdmin = cachedUsername === 'admin'
    applyCards(offlineCards)
    sessionLoading = false
    sessionChecked = true

    await tick()
    await renderCodes()
    return true
  }

  async function fetchCards() {
    loadingCards = true
    try {
      const payload = await api('/api/cards')
      const nextCards = payload.cards || []
      applyCards(nextCards)
      await writeOfflineCards(username, nextCards)
    } catch (error) {
      if (!isNetworkError(error)) throw error

      const cachedUsername = username || localStorage.getItem(offlineUserKey) || ''
      const offlineCards = await readOfflineCards(cachedUsername)
      if (cachedUsername) {
        applyCards(offlineCards)
        showFlash('Offline mode: showing cached cards')
      } else {
        throw error
      }
    } finally {
      loadingCards = false
    }
  }

  function asForm(card) {
    return {
      title: card.title || '',
      issuer: card.issuer || '',
      category: card.category || 'Other',
      cardholderName: card.cardholderName || '',
      identifier: card.identifier || '',
      barcodeValue: card.barcodeValue || '',
      barcodeFormat: card.barcodeFormat || 'CODE128',
      qrValue: card.qrValue || '',
      notes: card.notes || '',
      tagsText: (card.tags || []).join(', '),
      color: card.color || '#7c3aed',
      favorite: Boolean(card.favorite),
      frontImageDataUrl: card.frontImageDataUrl || '',
      backImageDataUrl: card.backImageDataUrl || '',
      expiryDate: card.expiryDate || '',
      securityCode: card.securityCode || ''
    }
  }

  function createNewCard() {
    editorId = null
    form = defaultCard()
    walletFace = 'front'
    mode = 'edit'
  }

  function selectCard(card) {
    selectedId = card.id
    walletFace = 'front'
    backImageSide = 'back'
    form = asForm(card)
  }

  async function scrollSelectedCardIntoView() {
    await tick()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function useCard(card) {
    selectCard(card)
    await scrollSelectedCardIntoView()

    try {
      const payload = await api(`/api/cards/${card.id}/use`, {
        method: 'POST',
        body: JSON.stringify({})
      })

      cards = cards
        .map(entry => entry.id === payload.card.id ? payload.card : entry)
        .sort((left, right) => {
          const leftUsedAt = left.lastUsedAt ? new Date(left.lastUsedAt).getTime() : 0
          const rightUsedAt = right.lastUsedAt ? new Date(right.lastUsedAt).getTime() : 0

          return (right.useCount || 0) - (left.useCount || 0)
            || Number(right.favorite) - Number(left.favorite)
            || rightUsedAt - leftUsedAt
            || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
            || Number(right.id) - Number(left.id)
        })
      await writeOfflineCards(username, cards)
    } catch {
      // Keep the selection responsive even if usage tracking fails.
    }
  }

  function openEditor(card = selectedCard) {
    if (card) {
      editorId = card.id
      form = asForm(card)
    } else {
      editorId = null
      form = defaultCard()
    }

    mode = 'edit'
  }

  function closeEditor() {
    mode = 'wallet'
    editorId = null
    form = selectedCard ? asForm(selectedCard) : defaultCard()
  }

  async function submitLogin() {
    loginError = ''
    try {
      const payload = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      })
      authenticated = true
      username = payload.username
      isAdmin = Boolean(payload.isAdmin)
      setOfflineUser(payload.username)
      loginPassword = ''
      await fetchCards()
    } catch (error) {
      loginError = error.message
    }
  }

  async function submitRegister() {
    registerError = ''

    if (!registerUsername.trim()) {
      registerError = 'Username is required.'
      return
    }

    if (registerPassword.length < 10) {
      registerError = 'Password must be at least 10 characters.'
      return
    }

    if (registerPassword !== registerPasswordConfirm) {
      registerError = 'Passwords do not match.'
      return
    }

    registering = true
    try {
      const payload = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: registerUsername, password: registerPassword })
      })
      authenticated = true
      username = payload.username
      isAdmin = Boolean(payload.isAdmin)
      setOfflineUser(payload.username)
      registerPassword = ''
      registerPasswordConfirm = ''
      await fetchCards()
    } catch (error) {
      registerError = error.message
    } finally {
      registering = false
    }
  }

  async function logout() {
    try {
      await api('/api/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch {
      // Local logout should still work if the network is unavailable.
    }

    authenticated = false
    username = ''
    isAdmin = false
    clearOfflineUser()
    cards = []
    selectedId = null
    editorId = null
    mode = 'wallet'
    walletFace = 'front'
    form = defaultCard()
  }

  function buildPayload() {
    return {
      ...form,
      tags: form.tagsText
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean)
    }
  }

  async function saveCard() {
    saving = true
    try {
      const isEditing = Boolean(editorId)
      const path = isEditing ? `/api/cards/${editorId}` : '/api/cards'
      const method = isEditing ? 'PUT' : 'POST'
      const payload = await api(path, {
        method,
        body: JSON.stringify(buildPayload())
      })

      if (isEditing) {
        cards = cards.map(card => card.id === payload.card.id ? payload.card : card)
      } else {
        cards = [payload.card, ...cards]
      }

      selectedId = payload.card.id
      editorId = payload.card.id
      selectCard(payload.card)
      mode = 'wallet'
      showFlash(isEditing ? 'Card updated' : 'Card saved')
      await fetchCards()
    } catch (error) {
      showFlash(error.message, 'error')
    } finally {
      saving = false
    }
  }

  async function deleteCard(id = editorId || selectedId) {
    if (!id || !window.confirm('Delete this card?')) return
    deleting = true
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' })
      cards = cards.filter(card => card.id !== id)
      mode = 'wallet'
      editorId = null
      walletFace = 'front'

      if (selectedId === id) {
        if (cards[0]) {
          selectCard(cards[0])
        } else {
          selectedId = null
          form = defaultCard()
        }
      } else {
        form = selectedCard ? asForm(selectedCard) : defaultCard()
      }

      showFlash('Card deleted')
      await writeOfflineCards(username, cards)
    } catch (error) {
      showFlash(error.message, 'error')
    } finally {
      deleting = false
    }
  }

  function updateField(field, value) {
    form = { ...form, [field]: value }
  }

  async function toggleWalletFace() {
    walletFace = walletFace === 'front' ? 'back' : 'front'
    backImageSide = 'back'
    if (walletFace === 'front') {
      await tick()
      await renderCodes()
    }
  }

  async function openZoomedCode(type) {
    if (type === 'barcode' && !form.barcodeValue) return
    if (type === 'qr' && !qrPreview) return
    zoomedCode = type
    zoomedBarcodeRotated = false

    if (type === 'barcode') {
      await tick()
      await renderCodes()
    }
  }

  function closeZoomedCode() {
    zoomedCode = null
  }

  async function renderCodes(nextBarcodeValue = form.barcodeValue, nextBarcodeFormat = form.barcodeFormat, nextQrValue = form.qrValue) {
    const token = ++renderCodesToken
    const qrValue = nextQrValue?.trim()
    const barcodeValue = nextBarcodeValue?.trim()
    const barcodeFormat = nextBarcodeFormat

    if (qrValue) {
      try {
        const nextQrPreview = await QRCode.toDataURL(qrValue, {
          margin: 1,
          width: 280,
          color: {
            dark: '#f8fafc',
            light: '#111218'
          }
        })
        if (token !== renderCodesToken) return
        qrPreview = nextQrPreview
      } catch {
        if (token !== renderCodesToken) return
        qrPreview = ''
      }
    } else {
      if (token !== renderCodesToken) return
      qrPreview = ''
    }

    await tick()
    if (token !== renderCodesToken) return

    barcodeError = ''
    for (const svgNode of [barcodeSvg, selectedBarcodeSvg, zoomedBarcodeSvg]) {
      if (!svgNode) continue
      while (svgNode.firstChild) {
        svgNode.removeChild(svgNode.firstChild)
      }
    }

    if (!barcodeValue) return

    try {
      const targets = [
        { node: barcodeSvg, height: 72, width: 1.7, fontSize: 16 },
        { node: selectedBarcodeSvg, height: 84, width: 1.9, fontSize: 18 },
        { node: zoomedBarcodeSvg, height: 116, width: 2.3, fontSize: 22 }
      ]

      for (const target of targets) {
        if (!target.node) continue
        JsBarcode(target.node, barcodeValue, {
          format: barcodeFormat,
          lineColor: '#111111',
          background: '#ffffff',
          height: target.height,
          width: target.width,
          displayValue: true,
          fontOptions: '600',
          fontSize: target.fontSize,
          margin: 8
        })
      }
    } catch (error) {
      if (token !== renderCodesToken) return
      barcodeError = error.message || 'Could not render barcode'
    }
  }

  async function compressImage(file) {
    const reader = new FileReader()
    const source = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = source
    })

    const maxWidth = 1600
    const scale = Math.min(1, maxWidth / image.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', 0.84)
  }

  async function handleImagePick(event, field) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    const dataUrl = await compressImage(file)
    updateField(field, dataUrl)
    event.currentTarget.value = ''
  }

  function clearImage(field) {
    updateField(field, '')
  }

  async function extractFromImages() {
    if (!settings.aiApiKey) {
      showFlash('Set your AI API key in Settings first', 'error')
      return
    }

    if (!form.frontImageDataUrl && !form.backImageDataUrl) {
      showFlash('Capture at least one card image first', 'error')
      return
    }

    extracting = true
    try {
      const payload = await api('/api/cards/extract', {
        method: 'POST',
        body: JSON.stringify({
          aiEndpoint: settings.aiEndpoint,
          aiModel: settings.aiModel,
          aiApiKey: settings.aiApiKey,
          frontImageDataUrl: form.frontImageDataUrl,
          backImageDataUrl: form.backImageDataUrl
        })
      })

      const data = payload.extracted || {}
      if (data.title) form = { ...form, title: data.title }
      if (data.issuer) form = { ...form, issuer: data.issuer }
      if (data.category) form = { ...form, category: data.category }
      if (data.cardholderName) form = { ...form, cardholderName: data.cardholderName }
      if (data.identifier) form = { ...form, identifier: data.identifier }
      if (data.barcodeValue) form = { ...form, barcodeValue: data.barcodeValue }
      if (data.barcodeFormat) form = { ...form, barcodeFormat: data.barcodeFormat }
      if (data.qrValue) form = { ...form, qrValue: data.qrValue }
      if (data.notes) form = { ...form, notes: data.notes }
      if (data.tags) form = { ...form, tagsText: data.tags }
      if (data.color) form = { ...form, color: data.color }
      if (data.expiryDate) form = { ...form, expiryDate: data.expiryDate }
      if (data.securityCode) form = { ...form, securityCode: data.securityCode }

      showFlash('Fields auto-filled from images')
    } catch (error) {
      showFlash(error.message || 'AI extraction failed', 'error')
    } finally {
      extracting = false
    }
  }

  async function changePassword() {
    changePwError = ''

    if (!changePwCurrent) {
      changePwError = 'Current password is required.'
      return
    }

    if (changePwNew.length < 10) {
      changePwError = 'New password must be at least 10 characters.'
      return
    }

    if (changePwNew !== changePwConfirm) {
      changePwError = 'Passwords do not match.'
      return
    }

    changePwSaving = true
    try {
      await api('/api/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: changePwCurrent, newPassword: changePwNew })
      })
      changePwCurrent = ''
      changePwNew = ''
      changePwConfirm = ''
      showFlash('Password changed')
    } catch (error) {
      changePwError = error.message
    } finally {
      changePwSaving = false
    }
  }

  async function installApp() {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    installPrompt = null
    installReady = false
  }

  async function exportMyCards() {
    userExporting = true
    try {
      const { blob, filename } = await apiBlob('/api/cards/export')
      downloadBlob(blob, filename || `card-keepr-${username}-cards.json`)
      showFlash('Card export downloaded')
    } catch (error) {
      showFlash(error.message, 'error')
    } finally {
      userExporting = false
    }
  }

  async function importMyCards(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    if (!window.confirm('Import cards from this JSON file? Imported cards will be added as new cards.')) return

    userImporting = true
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const result = await api('/api/cards/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      await fetchCards()
      showFlash(`Imported ${result.imported} card(s). Failed: ${result.failed}`)
    } catch (error) {
      showFlash(error.message || 'Import failed', 'error')
    } finally {
      userImporting = false
    }
  }

  async function downloadSqlBackup() {
    adminSqlDownloading = true
    try {
      const { blob, filename } = await apiBlob('/api/admin/backup/sql')
      downloadBlob(blob, filename || 'card-keepr-backup.sql.gz')
      showFlash('SQL backup downloaded')
    } catch (error) {
      showFlash(error.message, 'error')
    } finally {
      adminSqlDownloading = false
    }
  }

  async function restoreSqlBackup(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    if (!window.confirm('This will replace entire database from uploaded SQL backup. Continue only if you want full restore.')) return

    adminSqlRestoring = true
    try {
      const buffer = await file.arrayBuffer()
      await fetch('/api/admin/restore/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          'X-Card-Keepr-Confirm-Restore': 'restore-db'
        },
        credentials: 'same-origin',
        body: buffer
      }).then(async response => {
        if (response.status === 401) {
          authenticated = false
          username = ''
          isAdmin = false
          throw new Error('Authentication required')
        }

        if (!response.ok) {
          let message = 'Restore failed'
          try {
            const payload = await response.json()
            message = payload.error || message
          } catch {
            message = response.statusText || message
          }
          throw new Error(message)
        }
      })

      showFlash('SQL restore complete. Refreshing session...')
      await fetchSession()
    } catch (error) {
      showFlash(error.message || 'Restore failed', 'error')
    } finally {
      adminSqlRestoring = false
    }
  }

  async function openScanner(target) {
    scannerTarget = target
    scannerError = ''
    scannerStatus = target === 'qrValue' ? 'Looking for QR code' : 'Looking for barcode'
    scannerOpen = true

    if (!('BarcodeDetector' in window)) {
      scannerError = 'This browser does not expose BarcodeDetector. Use manual entry or camera capture instead.'
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }
        },
        audio: false
      })

      cameraStream = stream
      await tick()

      if (!videoEl) return
      videoEl.srcObject = stream
      await videoEl.play()

      const supported = await window.BarcodeDetector.getSupportedFormats()
      const formats = detectorFormatMap[target].filter(format => supported.includes(format))
      const detector = new window.BarcodeDetector({ formats: formats.length ? formats : supported })

      scannerTimer = window.setInterval(async () => {
        if (!videoEl || videoEl.readyState < 2) return
        try {
          const results = await detector.detect(videoEl)
          const hit = results.find(result => result.rawValue)
          if (hit?.rawValue) {
            updateField(target, hit.rawValue)
            showFlash(target === 'qrValue' ? 'QR code captured' : 'Barcode captured')
            closeScanner()
          }
        } catch {
          scannerStatus = 'Scanning...'
        }
      }, 400)
    } catch (error) {
      scannerError = error.message || 'Could not open the camera'
    }
  }

  function closeScanner() {
    scannerOpen = false
    if (scannerTimer) {
      window.clearInterval(scannerTimer)
      scannerTimer = null
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
      cameraStream = null
    }
  }

  function formatDate(value) {
    if (!value) return 'Fresh'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  }

  function categoryCount(category) {
    return cards.filter(card => card.category === category).length
  }

  onMount(() => {
    const storedTheme = localStorage.getItem('card-keepr-theme')
    if (storedTheme === 'light' || storedTheme === 'dark') {
      applyTheme(storedTheme)
    } else {
      applyTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    }

    try {
      const storedSettings = JSON.parse(localStorage.getItem('card-keepr-settings') || '{}')
      settings = {
        showWalletFilters: Boolean(storedSettings.showWalletFilters),
        aiEndpoint: storedSettings.aiEndpoint || 'https://api.openai.com/v1',
        aiModel: storedSettings.aiModel || 'gpt-4o',
        aiApiKey: storedSettings.aiApiKey || ''
      }
    } catch {
      settings = {
        showWalletFilters: false,
        aiEndpoint: 'https://api.openai.com/v1',
        aiModel: 'gpt-4o',
        aiApiKey: ''
      }
    }

    const splashTimer = window.setTimeout(() => {
      splashVisible = false
    }, 1000)

    const installListener = event => {
      event.preventDefault()
      installPrompt = event
      installReady = true
    }

    window.addEventListener('beforeinstallprompt', installListener)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    hydrateCachedSession()
      .catch(() => {})
      .finally(() => {
        fetchSession()
      })

    return () => {
      window.clearTimeout(splashTimer)
      window.removeEventListener('beforeinstallprompt', installListener)
      closeScanner()
    }
  })
</script>

<svelte:head>
  <title>Card Keepr</title>
</svelte:head>

{#if splashVisible}
  <div class="boot-splash" aria-hidden="true">
    <div class="boot-mark">CK</div>
    <h1>Card Keepr</h1>
    <p>Instant access to your wallet, minus the bulk.</p>
  </div>
{/if}

{#if sessionLoading && !sessionChecked}
  <main class="state-shell">
    <div class="glass state-card">
      <div class="spinner"></div>
      <p>Warming the vault...</p>
    </div>
  </main>
{:else if !authenticated}
  <main class="auth-shell">
    <section class="auth-hero">
      <div class="boot-mark">CK</div>
      <h1>Card Keepr</h1>
    </section>

    <section class="glass auth-card">
      <div class="auth-brand">
        <div>
          <strong>{authTab === 'login' ? 'Unlock your card vault' : 'Create your account'}</strong>
          <p>{authTab === 'login' ? 'Sign in with your credentials.' : 'Pick a username and a strong password.'}</p>
        </div>
        <button class="ghost theme-icon-button" aria-label={themeLabel} title={themeLabel} on:click={toggleTheme}>{themeIcon}</button>
      </div>

      <div class="auth-tabs">
        <button class="ghost compact" class:auth-tab-active={authTab === 'login'} on:click={() => { authTab = 'login'; loginError = ''; registerError = '' }}>Sign in</button>
        <button class="ghost compact" class:auth-tab-active={authTab === 'register'} on:click={() => { authTab = 'register'; loginError = ''; registerError = '' }}>Register</button>
      </div>

      {#if authTab === 'login'}
        <form class="auth-form" on:submit|preventDefault={submitLogin}>
          <label>
            Username
            <input bind:value={loginUsername} autocomplete="username" placeholder="admin" />
          </label>
          <label>
            Password
            <input bind:value={loginPassword} type="password" autocomplete="current-password" placeholder="Password" />
          </label>

          {#if loginError}
            <div class="flash error">{loginError}</div>
          {/if}

          <button class="primary" type="submit">Sign in</button>
        </form>
      {:else}
        <form class="auth-form" on:submit|preventDefault={submitRegister}>
          <label>
            Username
            <input bind:value={registerUsername} autocomplete="username" placeholder="johndoe" />
          </label>
          <label>
            Password <span class="auth-hint">(minimum 10 characters)</span>
            <input bind:value={registerPassword} type="password" autocomplete="new-password" placeholder="Strong password" />
          </label>
          <label>
            Confirm password
            <input bind:value={registerPasswordConfirm} type="password" autocomplete="new-password" placeholder="Repeat password" />
          </label>

          {#if registerError}
            <div class="flash error">{registerError}</div>
          {/if}

          <button class="primary" type="submit" disabled={registering}>{registering ? 'Creating account...' : 'Create account'}</button>
        </form>
      {/if}
    </section>
  </main>
{:else}
  <main class="app-shell">
    <header class="topbar">
      <div class="title-row">
        <div class="title-inline">
          <h1>Card Keepr</h1>
          <button class="ghost theme-icon-button" aria-label={themeLabel} title={themeLabel} on:click={toggleTheme}>{themeIcon}</button>
          <button class="ghost theme-icon-button" aria-label="Add card" title="Add card" on:click={createNewCard}>+</button>
          {#if selectedCard && !isSettingsMode && !isEditMode}
            <button class="ghost topbar-mini-button" aria-label="Edit card" title="Edit card" on:click={() => openEditor(selectedCard)}>Edit</button>
            <button class="ghost topbar-mini-button" aria-label="Delete card" title="Delete card" on:click={() => deleteCard(selectedCard.id)} disabled={deleting}>{deleting ? '...' : 'Del'}</button>
          {/if}
          {#if settings.showWalletFilters}
            <button class="ghost theme-icon-button" aria-label="Search" title="Search" on:click={toggleSearch}>🔎</button>
          {/if}
        </div>
      </div>
    </header>

    {#if isSettingsMode}
      <section class="settings-screen">
        <section class="glass settings-panel">
          <div class="panel-head compact-settings-head">
            <div>
              <div class="eyebrow">Settings</div>
              <h2>Wallet controls</h2>
            </div>
            <button class="ghost compact" on:click={closeSettings}>Done</button>
          </div>

          <div class="settings-ai-section">
            <div>
              <div class="eyebrow">AI Auto-fill</div>
              <h3>Image extraction</h3>
            </div>
            <p class="settings-ai-hint">Configure an OpenAI-compatible vision API to extract card details from photos.</p>

            <label>
              API endpoint
              <input value={settings.aiEndpoint} placeholder="https://api.openai.com/v1" on:input={(event) => updateSetting('aiEndpoint', event.currentTarget.value)} />
            </label>
            <label>
              Model
              <input value={settings.aiModel} placeholder="gpt-4o" on:input={(event) => updateSetting('aiModel', event.currentTarget.value)} />
            </label>
            <label>
              API key
              <input value={settings.aiApiKey} type="password" placeholder="sk-..." on:input={(event) => updateSetting('aiApiKey', event.currentTarget.value)} />
            </label>
          </div>

          <label class="settings-toggle-row">
            <div>
              <strong>Show search and filters</strong>
              <p>Keep the default wallet view minimal, or reveal search and category chips.</p>
            </div>
            <input checked={settings.showWalletFilters} type="checkbox" on:change={(event) => updateSetting('showWalletFilters', event.currentTarget.checked)} />
          </label>

          <div class="settings-ai-section">
            <div>
              <div class="eyebrow">Account</div>
              <h3>Change password</h3>
            </div>
            <p class="settings-ai-hint">Logged in as <strong>{username}</strong>. Minimum 10 characters.</p>

            <label>
              Current password
              <input bind:value={changePwCurrent} type="password" autocomplete="current-password" placeholder="Current password" />
            </label>
            <label>
              New password
              <input bind:value={changePwNew} type="password" autocomplete="new-password" placeholder="New password (10+ chars)" />
            </label>
            <label>
              Confirm new password
              <input bind:value={changePwConfirm} type="password" autocomplete="new-password" placeholder="Repeat new password" />
            </label>

            {#if changePwError}
              <div class="flash error">{changePwError}</div>
            {/if}

            <button class="primary compact" on:click={changePassword} disabled={changePwSaving}>{changePwSaving ? 'Saving...' : 'Update password'}</button>
          </div>

          <div class="settings-ai-section">
            <div>
              <div class="eyebrow">Backups</div>
              <h3>Your cards</h3>
            </div>
            <p class="settings-ai-hint">Export or import all cards for <strong>{username}</strong>. JSON includes images as stored data URLs.</p>

            <input bind:this={userImportInput} class="sr-only" type="file" accept="application/json,.json" on:change={importMyCards} />

            <div class="settings-action-row">
              <button class="ghost compact" on:click={exportMyCards} disabled={userExporting}>{userExporting ? 'Exporting...' : 'Export my cards (.json)'}</button>
              <button class="primary compact" on:click={() => userImportInput?.click()} disabled={userImporting}>{userImporting ? 'Importing...' : 'Import my cards (.json)'}</button>
            </div>
          </div>

          {#if isAdmin}
            <div class="settings-ai-section settings-danger-section">
              <div>
                <div class="eyebrow">Admin backup</div>
                <h3>Full database</h3>
              </div>
              <p class="settings-ai-hint">Download or restore full Postgres backup. SQL restore replaces all users and cards.</p>

              <input bind:this={adminRestoreInput} class="sr-only" type="file" accept=".gz,application/gzip,application/x-gzip,application/octet-stream" on:change={restoreSqlBackup} />

              <div class="settings-action-row">
                <button class="ghost compact" on:click={downloadSqlBackup} disabled={adminSqlDownloading}>{adminSqlDownloading ? 'Downloading...' : 'Download full SQL backup (.sql.gz)'}</button>
                <button class="primary compact danger-button" on:click={() => adminRestoreInput?.click()} disabled={adminSqlRestoring}>{adminSqlRestoring ? 'Restoring...' : 'Restore full SQL backup'}</button>
              </div>
            </div>
          {/if}

          {#if installReady}
            <button class="ghost compact settings-install" on:click={installApp}>Install app</button>
          {/if}
        </section>
      </section>
    {:else if !isEditMode}
      <section class="wallet-screen">
        {#if settings.showWalletFilters && (searchOpen || activeCategory !== 'All')}
          <section class="glass wallet-toolbar-panel mobile-wallet-toolbar">
            {#if searchOpen}
              <div class="vault-toolbar wallet-toolbar-inline">
                <input bind:value={search} placeholder="Search cards, tags, names..." />
              </div>
            {/if}

            <div class="chip-row wallet-filter-row">
              {#each categories as category}
                <button
                  class:chip-active={activeCategory === category}
                  class="chip"
                  on:click={() => activeCategory = category}
                >
                  {category}
                  {#if category !== 'All'}
                    <span>{categoryCount(category)}</span>
                  {/if}
                </button>
              {/each}
            </div>
          </section>
        {/if}

        {#if selectedCard}
          <section class="wallet-stage">
            <section
              bind:this={focusedCardEl}
              class="preview-card wallet-focus-card"
              style={`--card-accent: ${selectedCard.color || '#7c3aed'};`}
              role="button"
              tabindex="0"
              on:click={toggleWalletFace}
              on:keydown={(event) => (event.key === 'Enter' || event.key === ' ') && toggleWalletFace()}
            >
              {#if walletFace === 'front'}
                <div class="preview-title">{selectedCard.title || 'Untitled card'}</div>

                {#if selectedCard.category === 'Credit Card'}
                  <div class="credit-card-display">
                    <div class="cc-number">{selectedCard.identifier || '•••• •••• •••• ••••'}</div>
                    <div class="cc-details-row">
                      <div class="cc-detail">
                        <span class="cc-label">VALID THRU</span>
                        <span class="cc-value">{selectedCard.expiryDate || 'MM/YY'}</span>
                      </div>
                      <div class="cc-detail">
                        <span class="cc-label">CVV</span>
                        <span class="cc-value">{selectedCard.securityCode || '•••'}</span>
                      </div>
                      {#if selectedCard.cardholderName}
                        <div class="cc-detail cc-holder">
                          <span class="cc-label">CARDHOLDER</span>
                          <span class="cc-value">{selectedCard.cardholderName}</span>
                        </div>
                      {/if}
                    </div>
                  </div>
                {:else if !selectedCard.barcodeValue}
                  <div class="preview-identifier">{selectedCard.identifier || 'Card number or member ID'}</div>
                {/if}

                <div class="preview-code-stack interactive-code-stack">
                  {#if selectedCard.barcodeValue}
                    <button class="code-block barcode-block code-button" on:click|stopPropagation={() => openZoomedCode('barcode')}>
                      <svg bind:this={selectedBarcodeSvg} aria-label="Barcode preview"></svg>
                      {#if barcodeError}
                        <small>{barcodeError}</small>
                      {/if}
                    </button>
                  {/if}

                  {#if qrPreview}
                    <button class="code-block qr-block code-button" on:click|stopPropagation={() => openZoomedCode('qr')}>
                      <img src={qrPreview} alt="QR preview" />
                    </button>
                  {/if}

                  {#if !selectedCard.barcodeValue && !qrPreview}
                    <div class="empty-preview">This card does not have a barcode or QR code yet.</div>
                  {/if}
                </div>
              {:else}
                <div class="preview-back-face">
                  <div class="preview-topline">
                    {#if selectedCard.backImageDataUrl && selectedCard.frontImageDataUrl}
                      <div class="back-image-toggle">
                        <button class="ghost compact" class:back-toggle-active={backImageSide === 'front'} on:click|stopPropagation={() => backImageSide = 'front'}>Front</button>
                        <button class="ghost compact" class:back-toggle-active={backImageSide === 'back'} on:click|stopPropagation={() => backImageSide = 'back'}>Back</button>
                      </div>
                    {:else}
                      <span>{selectedCard.backImageDataUrl ? 'Back of card' : selectedCard.frontImageDataUrl ? 'Front of card' : 'Card details'}</span>
                    {/if}
                    <span>{formatDate(selectedCard.updatedAt)}</span>
                  </div>

                  {#if selectedCard.backImageDataUrl || selectedCard.frontImageDataUrl}
                    <div class="wallet-back-image-wrap">
                      <img src={backImageSide === 'front' && selectedCard.frontImageDataUrl ? selectedCard.frontImageDataUrl : selectedCard.backImageDataUrl || selectedCard.frontImageDataUrl} alt="Card image" class="wallet-back-image" />
                    </div>
                  {/if}

                  <dl class="wallet-info-list wallet-back-list">
                    <div><dt>Issuer</dt><dd>{selectedCard.issuer || 'None'}</dd></div>
                    <div><dt>Cardholder</dt><dd>{selectedCard.cardholderName || 'None'}</dd></div>
                    <div><dt>Identifier</dt><dd>{selectedCard.identifier || 'None'}</dd></div>
                    <div><dt>Category</dt><dd>{selectedCard.category || 'None'}</dd></div>
                    {#if selectedCard.category === 'Credit Card'}
                      <div><dt>Expiry</dt><dd>{selectedCard.expiryDate || 'None'}</dd></div>
                      <div><dt>CVV</dt><dd>{selectedCard.securityCode || 'None'}</dd></div>
                    {/if}
                  </dl>

                  {#if selectedCard.notes}
                    <p class="wallet-notes">{selectedCard.notes}</p>
                  {/if}
                </div>
              {/if}
            </section>
          </section>
        {/if}

        <section class="wallet-stack-shell mobile-stack-shell">
          {#if loadingCards}
            <div class="glass list-state wallet-empty">Loading cards...</div>
          {:else if filteredCards.length === 0}
            <div class="glass list-state wallet-empty">
              <strong>No cards yet</strong>
              <span>Add your first card to start the wallet stack.</span>
              <button class="primary compact" on:click={createNewCard}>Add card</button>
            </div>
          {:else if stackCards.length > 0}
            <div class="wallet-stack compact-wallet-stack">
              {#each stackCards as card, index (card.id)}
                <button
                  class="wallet-card wallet-stack-card"
                  style={`--card-accent: ${card.color || '#7c3aed'}; --stack-index: ${index};`}
                  on:click={() => useCard(card)}
                >
                  <div class="wallet-card-title">{card.title}</div>
                </button>
              {/each}
            </div>
          {/if}

          <div class="wallet-footer-actions">
            <button class="ghost compact wallet-footer-button" on:click={openSettings}>⚙</button>
            <button class="ghost compact wallet-footer-button" on:click={logout}>Log out</button>
          </div>
        </section>
      </section>
    {:else}
      <section class="edit-screen">
        <section class="editor-inline-shell">
          <section class="glass form-panel editor-form-panel">
            <div class="panel-head">
              <div>
                <div class="eyebrow">Card editor</div>
                <h2>{editorId ? 'Edit stored card' : 'Add a new card'}</h2>
              </div>
              <div class="panel-actions">
                {#if editorId}
                  <button class="ghost compact" on:click={() => deleteCard(editorId)} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
                {/if}
                <button class="ghost compact" on:click={closeEditor}>Back</button>
                <button class="primary compact" on:click={saveCard} disabled={saving}>{saving ? 'Saving...' : 'Save card'}</button>
              </div>
            </div>

            <div class="form-grid">
              <label>
                Title
                <input bind:value={form.title} placeholder="Library card" />
              </label>
              <label>
                Issuer
                <input bind:value={form.issuer} placeholder="City Library" />
              </label>
              <label>
                Category
                <select bind:value={form.category}>
                  {#each categories.filter(category => category !== 'All') as category}
                    <option value={category}>{category}</option>
                  {/each}
                </select>
              </label>
              <label>
                Accent color
                <input bind:value={form.color} type="color" />
              </label>
              <label>
                Cardholder name
                <input bind:value={form.cardholderName} placeholder="Jane Doe" />
              </label>
              <label>
                Identifier / number
                <input bind:value={form.identifier} placeholder="1234 5678 9012" />
              </label>
            </div>

            {#if form.category === 'Credit Card'}
              <div class="form-grid credit-card-grid">
                <label>
                  Expiry date
                  <input bind:value={form.expiryDate} placeholder="MM/YY" />
                </label>
                <label>
                  Security code (CVV)
                  <input bind:value={form.securityCode} placeholder="123" />
                </label>
              </div>
            {/if}

            <div class="form-grid code-grid">
              <label>
                Barcode value
                <div class="inline-input">
                  <input bind:value={form.barcodeValue} placeholder="Scan or paste barcode data" />
                  <button class="ghost compact" on:click={() => openScanner('barcodeValue')}>Scan</button>
                </div>
              </label>

              <label>
                Barcode format
                <select bind:value={form.barcodeFormat}>
                  {#each barcodeFormats as format}
                    <option value={format.value}>{format.label}</option>
                  {/each}
                </select>
              </label>

              <label>
                QR value
                <div class="inline-input">
                  <input bind:value={form.qrValue} placeholder="https://example.com/pass" />
                  <button class="ghost compact" on:click={() => openScanner('qrValue')}>Scan</button>
                </div>
              </label>
            </div>

            <label>
              Tags
              <input bind:value={form.tagsText} placeholder="groceries, family, local" />
            </label>

            <label>
              Notes
              <textarea bind:value={form.notes} rows="4" placeholder="Expiry date, branch details, usage notes..."></textarea>
            </label>

            <div class="toggle-row">
              <label class="checkbox-line">
                <input bind:checked={form.favorite} type="checkbox" />
                <span>Pin as favorite</span>
              </label>
            </div>

            <div class="media-section">
              <div class="media-header">
                <div>
                  <div class="eyebrow">ID capture</div>
                  <h3>Store front and back photos</h3>
                </div>
                <p>Works well on phones using the rear camera.</p>
              </div>

              <div class="media-actions">
                <input bind:this={frontInput} class="sr-only" type="file" accept="image/*" capture="environment" on:change={(event) => handleImagePick(event, 'frontImageDataUrl')} />
                <input bind:this={backInput} class="sr-only" type="file" accept="image/*" capture="environment" on:change={(event) => handleImagePick(event, 'backImageDataUrl')} />
                <button class="ghost compact" on:click={() => frontInput?.click()}>📷 Capture front</button>
                <button class="ghost compact" on:click={() => backInput?.click()}>📷 Capture back</button>
                {#if form.frontImageDataUrl || form.backImageDataUrl}
                  <button class="primary compact" on:click={extractFromImages} disabled={extracting}>
                    {extracting ? 'Reading card...' : 'Auto-fill with AI'}
                  </button>
                {/if}
              </div>

              <div class="media-grid">
                <article class="media-tile">
                  <header>
                    <span>Front</span>
                    {#if form.frontImageDataUrl}
                      <button class="link-button" on:click={() => clearImage('frontImageDataUrl')}>Remove</button>
                    {/if}
                  </header>
                  {#if form.frontImageDataUrl}
                    <img src={form.frontImageDataUrl} alt="Front ID" />
                  {:else}
                    <div class="media-empty">No front image yet</div>
                  {/if}
                </article>

                <article class="media-tile">
                  <header>
                    <span>Back</span>
                    {#if form.backImageDataUrl}
                      <button class="link-button" on:click={() => clearImage('backImageDataUrl')}>Remove</button>
                    {/if}
                  </header>
                  {#if form.backImageDataUrl}
                    <img src={form.backImageDataUrl} alt="Back ID" />
                  {:else}
                    <div class="media-empty">No back image yet</div>
                  {/if}
                </article>
              </div>
            </div>
          </section>
        </section>
      </section>
    {/if}

    {#if flash}
      <div class:flash-error={flash.tone === 'error'} class="flash toast">{flash.message}</div>
    {/if}
  </main>
{/if}

{#if scannerOpen}
  <div
    class="scanner-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    on:click={(event) => event.target === event.currentTarget && closeScanner()}
    on:keydown={(event) => event.key === 'Escape' && closeScanner()}
  >
    <section class="scanner-modal">
      <div class="panel-head compact-head">
        <div>
          <div class="eyebrow">Live scanner</div>
          <h2>{scannerTarget === 'qrValue' ? 'Scan QR code' : 'Scan barcode'}</h2>
        </div>
        <button class="ghost compact" on:click={closeScanner}>Close</button>
      </div>

      {#if scannerError}
        <div class="flash error">{scannerError}</div>
      {:else}
        <video bind:this={videoEl} playsinline muted></video>
        <p class="scanner-status">{scannerStatus}</p>
      {/if}
    </section>
  </div>
{/if}

{#if zoomedCode}
  <div
    class="scanner-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    on:click={(event) => event.target === event.currentTarget && closeZoomedCode()}
    on:keydown={(event) => event.key === 'Escape' && closeZoomedCode()}
  >
    <section class="scanner-modal code-zoom-modal">
      <div class="panel-head compact-head">
        <div>
          <div class="eyebrow">Expanded code</div>
          <h2>{zoomedCode === 'qr' ? 'QR code' : 'Barcode'}</h2>
        </div>
        <div class="panel-actions">
          {#if zoomedCode === 'barcode'}
            <button class="ghost compact" on:click={() => zoomedBarcodeRotated = !zoomedBarcodeRotated}>Rotate</button>
          {/if}
          <button class="ghost compact" on:click={closeZoomedCode}>Close</button>
        </div>
      </div>

      <div class="zoomed-code-body">
        {#if zoomedCode === 'barcode'}
          <div class:rotated={zoomedBarcodeRotated} class="code-block barcode-block zoomed-code-card zoomed-barcode-card">
            <svg bind:this={zoomedBarcodeSvg} aria-label="Expanded barcode"></svg>
          </div>
        {:else if zoomedCode === 'qr' && qrPreview}
          <div class="code-block qr-block zoomed-code-card">
            <img src={qrPreview} alt="Expanded QR preview" />
          </div>
        {/if}
      </div>
    </section>
  </div>
{/if}
