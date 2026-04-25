var SYNC_ALLOWLIST = [
  "settings.v3",
  "opencode-theme-id",
  "opencode-color-scheme",
  "opencode.global.dat:language",
  "opencode.global.dat:layout",
  "opencode.global.dat:layout.page",
]

var SYNC_DEBOUNCE_MS = 3000
var _isSyncPulling = false
var _isDirty = false
var _pushTimer = null
var _pullTimer = null
var _lastSyncTime = null
var _syncStatus = "idle"
var _syncUrl = ""
var _syncAuthHeader = ""
var _syncIntervalMs = 30000
var _deletedKeys = {}
var _dirtyVersion = 0
var _settingsSyncInitialized = false
var _origSetItem = null
var _origRemoveItem = null

function _isAllowlisted(key) {
  for (var i = 0; i < SYNC_ALLOWLIST.length; i++) {
    if (SYNC_ALLOWLIST[i] === key) return true
  }
  return false
}

function _base64Utf8(value) {
  if (typeof TextEncoder === "function") {
    var bytes = new TextEncoder().encode(value)
    var binary = ""
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)))
  }
  return Buffer.from(value, "utf8").toString("base64")
}

function _buildAuthHeader(authHeaderValue, username, password) {
  if (authHeaderValue) return { Authorization: authHeaderValue }
  if (username || password) {
    return { Authorization: "Basic " + _base64Utf8(username + ":" + password) }
  }
  return {}
}

function _collectBlob() {
  var blob = {}
  for (var i = 0; i < SYNC_ALLOWLIST.length; i++) {
    var key = SYNC_ALLOWLIST[i]
    var value = localStorage.getItem(key)
    if (value !== null) blob[key] = value
    else if (_deletedKeys[key]) blob[key] = null
  }
  return blob
}

function _markDirty() {
  _isDirty = true
  _dirtyVersion++
  _ensurePushTimer()
}

function _ensurePushTimer() {
  if (_pushTimer) return
  _pushTimer = setTimeout(function () {
    _pushTimer = null
    _doPush()
  }, SYNC_DEBOUNCE_MS)
}

function _doPush() {
  var versionAtStart = _dirtyVersion
  var deletedAtStart = Object.assign({}, _deletedKeys)
  var blob = _collectBlob()
  var keys = Object.keys(blob)
  if (keys.length === 0) {
    if (_dirtyVersion === versionAtStart) {
      _isDirty = false
      _deletedKeys = {}
    }
    return
  }
  var headers = Object.assign({ "Content-Type": "application/json" }, _syncAuthHeader)
  _syncStatus = "pushing"
  window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }

  fetch(_syncUrl, {
    method: "PUT",
    headers: headers,
    body: JSON.stringify(blob),
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status)
    if (_dirtyVersion === versionAtStart) {
      _isDirty = false
      _deletedKeys = {}
    } else {
      for (var key in deletedAtStart) {
        if (_deletedKeys[key] === deletedAtStart[key]) {
          delete _deletedKeys[key]
        }
      }
_ensurePushTimer()
    }
    _lastSyncTime = Date.now()
    _syncStatus = "connected"
    _updateSyncStatus()
  }).catch(function () {
    _syncStatus = "error"
    window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }
  })
}

function _doPull() {
  if (_isDirty || _pushTimer) {
    if (_pushTimer) {
      clearTimeout(_pushTimer)
      _pushTimer = null
    }
    _doPush()
    return
  }

  var headers = Object.assign({}, _syncAuthHeader)
  _syncStatus = "pulling"
  window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }

  fetch(_syncUrl, {
    method: "GET",
    headers: headers,
  }).then(function (response) {
    if (response.status === 404) {
      _lastSyncTime = Date.now()
      _syncStatus = "connected"
      _updateSyncStatus()
      if (Object.keys(_collectBlob()).length > 0) {
        _isDirty = true
        _doPush()
      }
      return
    }
    if (!response.ok) throw new Error("HTTP " + response.status)
    return response.json()
  }).then(function (remote) {
    if (!remote || typeof remote !== "object" || Array.isArray(remote)) return
    _isSyncPulling = true
    try {
      for (var i = 0; i < SYNC_ALLOWLIST.length; i++) {
        var key = SYNC_ALLOWLIST[i]
        if (Object.prototype.hasOwnProperty.call(remote, key)) {
          var value = remote[key]
          if (value === null) {
            localStorage.removeItem(key)
          } else if (typeof value === "string") {
            var localValue = localStorage.getItem(key)
            if (localValue !== value) {
              localStorage.setItem(key, value)
            }
          }
        }
      }
    } finally {
      _isSyncPulling = false
    }
    _lastSyncTime = Date.now()
    _syncStatus = "connected"
    _updateSyncStatus()
  }).catch(function () {
    _isSyncPulling = false
    _syncStatus = "error"
    window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }
  })
}

function _updateSyncStatus() {
  window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }
}

function _interceptSetItem(key, value) {
  _origSetItem.call(localStorage, key, value)
  if (!_isSyncPulling && _isAllowlisted(key)) {
    delete _deletedKeys[key]
    _markDirty()
  }
}

function _interceptRemoveItem(key) {
  _origRemoveItem.call(localStorage, key)
  if (!_isSyncPulling && _isAllowlisted(key)) {
    _markDirty()
    _deletedKeys[key] = _dirtyVersion
  }
}

function _formatRelativeTime(ms) {
  if (!ms) return "never"
  var diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  return Math.floor(diff / 86400) + "d ago"
}

function _createSyncPanel() {
  var panel = document.createElement("div")
  panel.setAttribute("data-component", "opencode-web-sync-panel")
  panel.setAttribute("data-status", _syncStatus)

  var statusRow = document.createElement("div")
  statusRow.setAttribute("data-component", "sync-status-row")

  var dot = document.createElement("span")
  dot.id = "opencode-web-sync-dot"
  dot.setAttribute("data-component", "sync-status-dot")

  var label = document.createElement("span")
  label.id = "opencode-web-sync-label"
  label.setAttribute("data-component", "sync-status-label")
  label.textContent = "Sync " + (_syncStatus === "connected" ? "ok" : _syncStatus === "error" ? "error" : _syncStatus || "idle")

  statusRow.appendChild(dot)
  statusRow.appendChild(label)
  panel.appendChild(statusRow)

  var timeRow = document.createElement("div")
  timeRow.id = "opencode-web-sync-time"
  timeRow.setAttribute("data-component", "sync-time-row")
  timeRow.textContent = "Last checked: " + _formatRelativeTime(_lastSyncTime)
  panel.appendChild(timeRow)

  var syncBtn = document.createElement("button")
  syncBtn.setAttribute("data-component", "sync-now-btn")
  syncBtn.textContent = "Sync now"
  syncBtn.onclick = function (e) {
    e.stopPropagation()
    _doPull()
  }
  panel.appendChild(syncBtn)

  var urlRow = document.createElement("div")
  urlRow.setAttribute("data-component", "sync-url-row")
  urlRow.textContent = _syncUrl.length > 40 ? _syncUrl.slice(0, 37) + "..." : _syncUrl
  urlRow.title = _syncUrl
  panel.appendChild(urlRow)

  var refreshPanel = function () {
    panel.setAttribute("data-status", _syncStatus)
    label.textContent = "Sync " + (_syncStatus === "connected" ? "ok" : _syncStatus === "error" ? "error" : _syncStatus || "idle")
    timeRow.textContent = "Last checked: " + _formatRelativeTime(_lastSyncTime)
  }

  panel._refreshPanel = refreshPanel
  return panel
}

function _togglePanel(wrapper) {
  var existing = wrapper.querySelector('[data-component="opencode-web-sync-panel"]')
  if (existing) {
    existing.remove()
    return
  }

  var panel = _createSyncPanel()
  wrapper.appendChild(panel)

  var intervalId = setInterval(function () {
    if (!wrapper.contains(panel)) {
      clearInterval(intervalId)
      return
    }
    if (panel._refreshPanel) panel._refreshPanel()
  }, 10000)

  setTimeout(function () {
    document.addEventListener("click", function handler(e) {
      if (!wrapper.contains(e.target)) {
        if (wrapper.contains(panel)) panel.remove()
        document.removeEventListener("click", handler)
      }
    })
  }, 0)
}

function _createSyncButton() {
  var wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "tooltip-trigger")

  var btn = document.createElement("button")
  btn.setAttribute("data-component", "opencode-web-sync-btn")
  btn.setAttribute("data-variant", "ghost")
  btn.setAttribute("data-size", "large")
  btn.setAttribute("data-icon", "cloud-upload")
  btn.setAttribute("aria-label", "Settings sync")

  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" stroke="currentColor"><path d="M12.0833 16.25H15C17.0711 16.25 18.75 14.5711 18.75 12.5C18.75 10.5649 17.2843 8.97217 15.4025 8.77133C15.2 6.13103 12.8586 4.08333 10 4.08333C7.71532 4.08333 5.76101 5.49781 4.96501 7.49881C2.84892 7.90461 1.25 9.76559 1.25 11.6667C1.25 13.9813 3.30203 16.25 5.83333 16.25H7.91667M10 16.25V10.4167M12.0833 11.875L10 9.79167L7.91667 11.875" stroke="currentColor" stroke-linecap="square"/></svg>'

  btn.onclick = function (e) {
    e.stopPropagation()
    _togglePanel(wrapper)
  }

  wrapper.appendChild(btn)
  return wrapper
}

function _injectSyncButton() {
  var observer = new MutationObserver(function () {
    var rail = document.querySelector('[data-component="sidebar-rail"]')
    if (!rail) return

    var bottom = rail.querySelector(".shrink-0.w-full")
    if (!bottom) return

    if (bottom.querySelector('[data-component="opencode-web-sync-btn"]')) return

    observer.disconnect()

    var settingsBtn = bottom.querySelector('[data-icon="settings-gear"]')
    if (settingsBtn) {
      var trigger = settingsBtn.closest('[data-component="tooltip-trigger"]')
      if (trigger && trigger.parentNode) {
        trigger.parentNode.insertBefore(_createSyncButton(), trigger)
        return
      }
    }

    bottom.insertBefore(_createSyncButton(), bottom.firstChild)
  })

  var root = document.getElementById("root")
  if (root) observer.observe(root, { childList: true, subtree: true })
}

function initSettingsSync(url, intervalSec, authHeader, username, password) {
  if (_settingsSyncInitialized) return
  _settingsSyncInitialized = true
  _syncUrl = url
  _syncAuthHeader = _buildAuthHeader(authHeader, username, password)
  _syncIntervalMs = Math.max(5, parseInt(intervalSec, 10) || 30) * 1000

  _origSetItem = localStorage.setItem.bind(localStorage)
  _origRemoveItem = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = _interceptSetItem
  localStorage.removeItem = _interceptRemoveItem

  _pullTimer = setInterval(_doPull, _syncIntervalMs)
  _doPull()

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      if (_isDirty) { _doPush() } else { _doPull() }
    } else if (_isDirty) {
      _doPush()
    }
  })

  _injectSyncButton()

  window.__OPENCODE_SYNC_STATUS = { status: _syncStatus, lastSync: _lastSyncTime, url: _syncUrl }
}