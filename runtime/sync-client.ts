import { createBlobSync } from "./blob-sync"
import type { BlobSyncApi, BlobSyncConfig, SyncClientDeps, SyncStatus, SyncStatusInfo } from "./types"

const SYNC_ALLOWLIST: readonly string[] = [
  "settings.v3",
  "opencode-theme-id",
  "opencode-color-scheme",
  "opencode.global.dat:language",
  "opencode.global.dat:layout",
  "opencode.global.dat:layout.page",
]

function _isAllowlisted(key: string): boolean {
  return SYNC_ALLOWLIST.includes(key)
}

function _base64Utf8(value: string): string {
  if (typeof TextEncoder === "function") {
    const bytes = new TextEncoder().encode(value)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  }
  return btoa(unescape(encodeURIComponent(value)))
}

function _buildAuthHeader(
  authHeaderValue: string,
  username: string,
  password: string,
): Record<string, string> {
  if (authHeaderValue) return { Authorization: authHeaderValue }
  if (username || password) {
    return { Authorization: "Basic " + _base64Utf8(username + ":" + password) }
  }
  return {}
}

function _readLocalBlob(
  localStorage: Storage,
): Record<string, string | null> {
  const blob: Record<string, string | null> = {}
  for (const key of SYNC_ALLOWLIST) {
    const value = localStorage.getItem(key)
    if (value !== null) blob[key] = value
  }
  return blob
}

function _applyRemoteBlob(
  remote: Record<string, unknown>,
  localStorage: Storage,
  isSyncPullingRef: { value: boolean },
): void {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return
  isSyncPullingRef.value = true
  try {
    for (const key of SYNC_ALLOWLIST) {
      if (Object.prototype.hasOwnProperty.call(remote, key)) {
        const value = remote[key]
        if (value === null) {
          localStorage.removeItem(key)
        } else if (typeof value === "string") {
          const localValue = localStorage.getItem(key)
          if (localValue !== value) {
            localStorage.setItem(key, value)
          }
        }
      }
    }
  } finally {
    isSyncPullingRef.value = false
  }
}

function _formatRelativeTime(ms: number | null): string {
  if (!ms) return "never"
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  return Math.floor(diff / 86400) + "d ago"
}

function _createSyncPanel(
  deps: SyncClientDeps,
  syncUrl: string,
  resolveFirstSync: ((choice: string) => void) | null,
  sync: BlobSyncApi | null,
  origSetItem: Storage["setItem"] | null,
  origRemoveItem: Storage["removeItem"] | null,
): HTMLDivElement & { _refreshPanel?: () => void } {
  const statusInfo = deps.window.__OPENCODE_SYNC_STATUS as SyncStatusInfo | null | undefined
  const status: SyncStatus = statusInfo ? statusInfo.status : "idle"
  const lastSync = statusInfo ? statusInfo.lastSync : null
  const url = statusInfo ? statusInfo.url : syncUrl

  const panel = deps.document.createElement("div") as HTMLDivElement & { _refreshPanel?: () => void }
  panel.setAttribute("data-component", "opencode-web-sync-panel")
  panel.setAttribute("data-status", status)

  const statusRow = deps.document.createElement("div")
  statusRow.setAttribute("data-component", "sync-status-row")

  const dot = deps.document.createElement("span")
  dot.setAttribute("data-component", "sync-status-dot")

  const label = deps.document.createElement("span")
  label.setAttribute("data-component", "sync-status-label")

  if (status === "first-sync-pending") {
    label.textContent = "Sync conflict"
  } else if (status === "disabled") {
    label.textContent = "Sync disabled"
  } else {
    label.textContent =
      "Sync " +
      (status === "connected"
        ? "ok"
        : status === "error"
          ? "error"
          : status || "idle")
  }

  statusRow.appendChild(dot)
  statusRow.appendChild(label)
  panel.appendChild(statusRow)

  if (status === "first-sync-pending") {
    const desc = deps.document.createElement("div")
    desc.setAttribute("data-component", "sync-conflict-desc")
    desc.textContent = "This device has settings that differ from the synced version."
    desc.style.cssText = "color: var(--muted-foreground, #999); margin-bottom: 8px;"
    panel.appendChild(desc)

    const useServerBtn = deps.document.createElement("button")
    useServerBtn.setAttribute("data-component", "sync-choice-btn-primary")
    useServerBtn.textContent = "Use server settings"
    useServerBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation()
      if (resolveFirstSync) resolveFirstSync("server")
    }
    panel.appendChild(useServerBtn)

    const dontSyncBtn = deps.document.createElement("button")
    dontSyncBtn.setAttribute("data-component", "sync-choice-btn")
    dontSyncBtn.textContent = "Don\u2019t sync"
    dontSyncBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation()
      if (sync) sync.stop()
      if (origSetItem) deps.localStorage.setItem = origSetItem
      if (origRemoveItem) deps.localStorage.removeItem = origRemoveItem
      deps.localStorage.setItem("opencode-sync-declined", "1")
      const existingPanel = deps.document.querySelector('[data-component="opencode-web-sync-panel"]')
      if (existingPanel) existingPanel.remove()
      const wrapper = deps.document.querySelector('[data-component="opencode-web-sync-btn"]')
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.appendChild(
          _createSyncPanel(deps, syncUrl, null, sync, origSetItem, origRemoveItem),
        )
      }
    }
    panel.appendChild(dontSyncBtn)
  } else if (status === "disabled") {
    const reEnableBtn = deps.document.createElement("button")
    reEnableBtn.setAttribute("data-component", "sync-now-btn")
    reEnableBtn.textContent = "Re-enable sync"
    reEnableBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation()
      deps.localStorage.removeItem("opencode-sync-last-success")
      deps.localStorage.removeItem("opencode-sync-declined")
      deps.location.reload()
    }
    panel.appendChild(reEnableBtn)
  } else {
    const timeRow = deps.document.createElement("div")
    timeRow.id = "opencode-web-sync-time"
    timeRow.setAttribute("data-component", "sync-time-row")
    timeRow.textContent = "Last checked: " + _formatRelativeTime(lastSync)
    panel.appendChild(timeRow)

    const syncBtn = deps.document.createElement("button")
    syncBtn.setAttribute("data-component", "sync-now-btn")
    syncBtn.textContent = "Sync now"
    syncBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation()
      if (sync) sync.pullNow()
    }
    panel.appendChild(syncBtn)
  }

  if (status !== "first-sync-pending" && status !== "disabled") {
    const urlRow = deps.document.createElement("div")
    urlRow.setAttribute("data-component", "sync-url-row")
    urlRow.textContent = url.length > 40 ? url.slice(0, 37) + "..." : url
    urlRow.title = url
    panel.appendChild(urlRow)
  }

  const refreshPanel = () => {
    const currentInfo = deps.window.__OPENCODE_SYNC_STATUS as SyncStatusInfo | null | undefined
    const currentStatus: SyncStatus = currentInfo ? currentInfo.status : "idle"
    const currentLastSync = currentInfo ? currentInfo.lastSync : null

    const existingPanel = panel.parentNode
      ? panel.parentNode.querySelector('[data-component="opencode-web-sync-panel"]')
      : null
    if (existingPanel && existingPanel !== panel) return
    if (currentStatus !== status) {
      if (panel.parentNode) {
        panel.remove()
        const wrapper = deps.document.querySelector('[data-component="opencode-web-sync-btn"]')
        if (wrapper && wrapper.parentNode) {
          wrapper.parentNode.appendChild(
            _createSyncPanel(deps, syncUrl, resolveFirstSync, sync, origSetItem, origRemoveItem),
          )
        }
      }
      return
    }
    panel.setAttribute("data-status", currentStatus)
    if (label) {
      label.textContent =
        "Sync " +
        (currentStatus === "connected"
          ? "ok"
          : currentStatus === "error"
            ? "error"
            : currentStatus || "idle")
    }
    const timeEl = panel.querySelector('[data-component="sync-time-row"]')
    if (timeEl) {
      timeEl.textContent = "Last checked: " + _formatRelativeTime(currentLastSync)
    }
  }

  panel._refreshPanel = refreshPanel
  return panel
}

function _togglePanel(
  deps: SyncClientDeps,
  syncUrl: string,
  resolveFirstSync: ((choice: string) => void) | null,
  sync: BlobSyncApi | null,
  origSetItem: Storage["setItem"] | null,
  origRemoveItem: Storage["removeItem"] | null,
  wrapper: HTMLElement,
): void {
  const existing = wrapper.querySelector('[data-component="opencode-web-sync-panel"]')
  if (existing) {
    existing.remove()
    return
  }

  const panel = _createSyncPanel(deps, syncUrl, resolveFirstSync, sync, origSetItem, origRemoveItem)
  wrapper.appendChild(panel)

  const intervalId = deps.setInterval(() => {
    if (!wrapper.contains(panel)) {
      deps.clearInterval(intervalId)
      return
    }
    if (panel._refreshPanel) panel._refreshPanel()
  }, 10000)

  deps.setTimeout(() => {
    deps.document.addEventListener("click", function handler(e: MouseEvent) {
      if (!wrapper.contains(e.target as Node)) {
        if (wrapper.contains(panel)) panel.remove()
        deps.document.removeEventListener("click", handler)
      }
    })
  }, 0)
}

function _createSyncButton(
  deps: SyncClientDeps,
  syncUrl: string,
  resolveFirstSync: ((choice: string) => void) | null,
  sync: BlobSyncApi | null,
  origSetItem: Storage["setItem"] | null,
  origRemoveItem: Storage["removeItem"] | null,
): HTMLElement {
  const wrapper = deps.document.createElement("div")
  wrapper.setAttribute("data-component", "tooltip-trigger")

  const btn = deps.document.createElement("button")
  btn.setAttribute("data-component", "opencode-web-sync-btn")
  btn.setAttribute("data-variant", "ghost")
  btn.setAttribute("data-size", "large")
  btn.setAttribute("data-icon", "cloud-upload")
  btn.setAttribute("aria-label", "Settings sync")

  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" stroke="currentColor"><path d="M12.0833 16.25H15C17.0711 16.25 18.75 14.5711 18.75 12.5C18.75 10.5649 17.2843 8.97217 15.4025 8.77133C15.2 6.13103 12.8586 4.08333 10 4.08333C7.71532 4.08333 5.76101 5.49781 4.96501 7.49881C2.84892 7.90461 1.25 9.76559 1.25 11.6667C1.25 13.9813 3.30203 16.25 5.83333 16.25H7.91667M10 16.25V10.4167M12.0833 11.875L10 9.79167L7.91667 11.875" stroke="currentColor" stroke-linecap="square"/></svg>'

  btn.onclick = (e: MouseEvent) => {
    e.stopPropagation()
    _togglePanel(deps, syncUrl, resolveFirstSync, sync, origSetItem, origRemoveItem, wrapper)
  }

  wrapper.appendChild(btn)
  return wrapper
}

function _injectSyncButton(
  deps: SyncClientDeps,
  syncUrl: string,
  resolveFirstSync: ((choice: string) => void) | null,
  sync: BlobSyncApi | null,
  origSetItem: Storage["setItem"] | null,
  origRemoveItem: Storage["removeItem"] | null,
): void {
  const observer = new deps.MutationObserver(() => {
    const rail = deps.document.querySelector('[data-component="sidebar-rail"]')
    if (!rail) return

    const bottom = rail.querySelector(".shrink-0.w-full")
    if (!bottom) return

    if (bottom.querySelector('[data-component="opencode-web-sync-btn"]')) return

    observer.disconnect()

    const settingsBtn = bottom.querySelector('[data-icon="settings-gear"]')
    if (settingsBtn) {
      const trigger = settingsBtn.closest('[data-component="tooltip-trigger"]')
      if (trigger && trigger.parentNode) {
        trigger.parentNode.insertBefore(
          _createSyncButton(deps, syncUrl, resolveFirstSync, sync, origSetItem, origRemoveItem),
          trigger,
        )
        return
      }
    }

    bottom.insertBefore(
      _createSyncButton(deps, syncUrl, resolveFirstSync, sync, origSetItem, origRemoveItem),
      bottom.firstChild,
    )
  })

  const root = deps.document.getElementById("root")
  if (root) observer.observe(root, { childList: true, subtree: true })
}

let _globalSyncInitialized = false

export function _resetSyncInitialized(): void {
  _globalSyncInitialized = false
}

export function initSettingsSync(
  url: string,
  intervalSec?: string,
  authHeader?: string,
  username?: string,
  password?: string,
  deps?: Partial<SyncClientDeps>,
): void {
  const d: SyncClientDeps = {
    localStorage: deps?.localStorage ?? localStorage,
    fetch: deps?.fetch ?? fetch.bind(globalThis),
    setTimeout: deps?.setTimeout ?? setTimeout.bind(globalThis),
    clearTimeout: deps?.clearTimeout ?? clearTimeout.bind(globalThis),
    setInterval: deps?.setInterval ?? setInterval.bind(globalThis),
    clearInterval: deps?.clearInterval ?? clearInterval.bind(globalThis),
    document: deps?.document ?? document,
    location: deps?.location ?? location,
    window: deps?.window ?? window,
    MutationObserver: deps?.MutationObserver ?? MutationObserver,
    console: deps?.console ?? console,
  }

  if (_globalSyncInitialized) return
  _globalSyncInitialized = true
  const _isSyncPullingRef = { value: false }
  let _origSetItem: Storage["setItem"] | null = null
  let _origRemoveItem: Storage["removeItem"] | null = null
  let _sync: BlobSyncApi | null = null
  const _syncUrl = url
  const _syncAuthHeader = _buildAuthHeader(authHeader ?? "", username ?? "", password ?? "")
  const _syncIntervalMs = Math.max(5, parseInt(intervalSec ?? "30", 10) || 30) * 1000
  let _resolveFirstSync: ((choice: string) => void) | null = null

  const declined = d.localStorage.getItem("opencode-sync-declined")
  if (declined) {
    ;(d.window as unknown as Record<string, unknown>).__OPENCODE_SYNC_STATUS = {
      status: "disabled",
      lastSync: null,
      url: _syncUrl,
    } satisfies SyncStatusInfo
    _injectSyncButton(d, _syncUrl, null, null, null, null)
    return
  }

  let lastSyncTime: number | null = null
  const lastSyncRaw = d.localStorage.getItem("opencode-sync-last-success")
  if (lastSyncRaw) {
    const parsed = parseInt(lastSyncRaw, 10)
    if (!isNaN(parsed)) lastSyncTime = parsed
  }

  _origSetItem = d.localStorage.setItem.bind(d.localStorage)
  _origRemoveItem = d.localStorage.removeItem.bind(d.localStorage)

  _sync = createBlobSync({
    readLocalBlob: () => _readLocalBlob(d.localStorage),
    applyRemoteBlob: (remote) => _applyRemoteBlob(remote, d.localStorage, _isSyncPullingRef),
    pullRemoteBlob: () => {
      const headers: Record<string, string> = { ..._syncAuthHeader }
      return d
        .fetch(_syncUrl, {
          method: "GET",
          headers,
        })
        .then((response) => {
          if (response.status === 404) {
            return { status: 404, body: null }
          }
          if (!response.ok) {
            return { status: response.status, body: null }
          }
          return response.json().then((body: Record<string, unknown>) => {
            return { status: response.status, body }
          })
        })
    },
    pushRemoteBlob: (blob) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ..._syncAuthHeader,
      }
      return d
        .fetch(_syncUrl, {
          method: "PUT",
          headers,
          body: JSON.stringify(blob),
        })
        .then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status)
        })
    },
    onStatusChange: (status, ts, url) => {
      ;(d.window as unknown as Record<string, unknown>).__OPENCODE_SYNC_STATUS = {
        status,
        lastSync: ts,
        url,
      } satisfies SyncStatusInfo
      if (status === "connected") {
        d.localStorage.setItem("opencode-sync-last-success", String(ts))
      }
      const panel = d.document.querySelector('[data-component="opencode-web-sync-panel"]')
      if (panel && (panel as HTMLDivElement & { _refreshPanel?: () => void })._refreshPanel)
        (panel as HTMLDivElement & { _refreshPanel?: () => void })._refreshPanel!()
    },
    onFirstSyncDivergence: (local, remote, resolve) => {
      _resolveFirstSync = resolve
      const panel = d.document.querySelector('[data-component="opencode-web-sync-panel"]')
      if (panel) {
        panel.remove()
      }
      const wrapper = d.document.querySelector('[data-component="opencode-web-sync-btn"]')
      if (wrapper) {
        const parent = wrapper.parentNode
        if (parent) {
          const newPanel = _createSyncPanel(
            d,
            _syncUrl,
            _resolveFirstSync,
            _sync,
            _origSetItem,
            _origRemoveItem,
          )
          parent.appendChild(newPanel)
        }
      }
    },
    lastSyncTime,
    debounceMs: 3000,
    intervalMs: _syncIntervalMs,
    url: _syncUrl,
    setTimeout: d.setTimeout as unknown as BlobSyncConfig["setTimeout"],
    clearTimeout: d.clearTimeout as unknown as BlobSyncConfig["clearTimeout"],
    setInterval: d.setInterval as unknown as BlobSyncConfig["setInterval"],
    clearInterval: d.clearInterval as unknown as BlobSyncConfig["clearInterval"],
  })

  d.localStorage.setItem = (key: string, value: string) => {
    _origSetItem!.call(d.localStorage, key, value)
    if (!_isSyncPullingRef.value && _isAllowlisted(key)) {
      if (_sync) _sync.clearDeleted(key)
      if (_sync) _sync.markDirty()
    }
  }

  d.localStorage.removeItem = (key: string) => {
    _origRemoveItem!.call(d.localStorage, key)
    if (!_isSyncPullingRef.value && _isAllowlisted(key)) {
      if (_sync) _sync.markDeleted(key)
    }
  }

  d.document.addEventListener("visibilitychange", () => {
    const statusInfo = d.window.__OPENCODE_SYNC_STATUS as SyncStatusInfo | null | undefined
    const status = statusInfo ? statusInfo.status : ""
    if (status === "first-sync-pending" || status === "disabled") return
    if (!d.document.hidden) {
      _sync!.pullNow()
    }
  })

  _injectSyncButton(d, _syncUrl, _resolveFirstSync, _sync, _origSetItem, _origRemoveItem)
}

export { SYNC_ALLOWLIST, _isAllowlisted, _buildAuthHeader, _base64Utf8, _formatRelativeTime, _readLocalBlob, _applyRemoteBlob }