import type { BlobSyncConfig, BlobSyncApi, SyncStatus } from "./types"

export function createBlobSync(config: BlobSyncConfig): BlobSyncApi {
  const _setTimeout = config.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms))
  const _clearTimeout = config.clearTimeout ?? ((id: unknown) => globalThis.clearTimeout(id as number))
  const _setInterval = config.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms))
  const _clearInterval = config.clearInterval ?? ((id: unknown) => globalThis.clearInterval(id as number))
  const _dateNow = config.dateNow ?? (() => Date.now())

  let _isDirty = false
  let _dirtyVersion = 0
  const _deletedKeys: Record<string, number> = {}
  let _pushTimer: unknown = null
  let _pullTimerId: unknown = null
  let _lastSyncTime = config.lastSyncTime ?? null
  let _syncStatus: SyncStatus = "idle"
  let _hasSynced = _lastSyncTime !== null
  let _pendingRemote: Record<string, unknown> | null = null
  let _paused = false
  const _url = config.url || ""

  const debounceMs = config.debounceMs ?? 3000
  const intervalMs = config.intervalMs ?? 30000

  function _setStatus(status: SyncStatus): void {
    _syncStatus = status
    config.onStatusChange(status, _lastSyncTime, _url)
  }

  function _ensurePushTimer(): void {
    if (_paused) return
    if (_pushTimer) return
    _pushTimer = _setTimeout(() => {
      _pushTimer = null
      _doPush()
    }, debounceMs)
  }

  function markDirty(): void {
    _isDirty = true
    _dirtyVersion++
    _ensurePushTimer()
  }

  function markDeleted(key: string): void {
    _deletedKeys[key] = _dirtyVersion
    _isDirty = true
    _dirtyVersion++
    _ensurePushTimer()
  }

  function clearDeleted(key: string): void {
    delete _deletedKeys[key]
  }

  function _doPush(): void {
    const versionAtStart = _dirtyVersion
    const deletedAtStart = { ..._deletedKeys }
    const blob = config.readLocalBlob()
    for (const dk in _deletedKeys) {
      if (!Object.prototype.hasOwnProperty.call(blob, dk)) {
        blob[dk] = null
      }
    }
    const keys = Object.keys(blob)
    if (keys.length === 0) {
      if (_dirtyVersion === versionAtStart) {
        _isDirty = false
        for (const k in _deletedKeys) delete _deletedKeys[k]
      }
      return
    }
    _setStatus("pushing")
    config
      .pushRemoteBlob(blob)
      .then(() => {
        if (_dirtyVersion === versionAtStart) {
          _isDirty = false
          for (const k in _deletedKeys) delete _deletedKeys[k]
        } else {
          for (const key in deletedAtStart) {
            if (_deletedKeys[key] === deletedAtStart[key]) {
              delete _deletedKeys[key]
            }
          }
          _ensurePushTimer()
        }
        _lastSyncTime = _dateNow()
        _hasSynced = true
        _setStatus("connected")
      })
      .catch(() => {
        _setStatus("error")
      })
  }

  function _doPull(): void {
    if (_paused) return
    if (_isDirty || _pushTimer) {
      if (_pushTimer) {
        _clearTimeout(_pushTimer)
        _pushTimer = null
      }
      _doPush()
      return
    }

    _setStatus("pulling")

    config
      .pullRemoteBlob()
      .then((result) => {
        if (result.status === 404) {
          _lastSyncTime = _dateNow()
          _hasSynced = true
          _setStatus("connected")
          const localBlob = config.readLocalBlob()
          if (Object.keys(localBlob).length > 0) {
            _isDirty = true
            _doPush()
          }
          return
        }
        if (result.status < 200 || result.status >= 300 || result.body === null) {
          return
        }
        const remote = result.body
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) return

        if (!_hasSynced && config.lastSyncTime === null && config.onFirstSyncDivergence) {
          const localBlob2 = config.readLocalBlob()
          const localKeys = Object.keys(localBlob2)
          if (localKeys.length === 0) {
            config.applyRemoteBlob(remote)
            _lastSyncTime = _dateNow()
            _hasSynced = true
            _setStatus("connected")
            return
          }
          let hasDivergence = false
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allKeys: Record<string, unknown> = { ...localBlob2, ...(remote as Record<string, unknown>) }
          for (const k in allKeys) {
            if (Object.prototype.hasOwnProperty.call(allKeys, k)) {
              const localVal = Object.prototype.hasOwnProperty.call(localBlob2, k) ? localBlob2[k] : undefined
              const remoteVal = Object.prototype.hasOwnProperty.call(remote, k) ? remote[k] : undefined
              if (localVal !== remoteVal) {
                hasDivergence = true
                break
              }
            }
          }
          if (hasDivergence) {
            _pendingRemote = remote
            _paused = true
            _syncStatus = "first-sync-pending"
            config.onStatusChange("first-sync-pending", _lastSyncTime, _url)
            config.onFirstSyncDivergence(localBlob2, remote, resolveFirstSync)
            return
          }
        }

        config.applyRemoteBlob(remote)
        _lastSyncTime = _dateNow()
        _hasSynced = true
        _setStatus("connected")
      })
      .catch(() => {
        _setStatus("error")
      })
  }

  function resolveFirstSync(choice: string): void {
    if (choice !== "server") return
    if (!_pendingRemote) return
    config.applyRemoteBlob(_pendingRemote as Record<string, unknown>)
    _pendingRemote = null
    _hasSynced = true
    _paused = false
    _lastSyncTime = _dateNow()
    _syncStatus = "connected"
    config.onStatusChange("connected", _lastSyncTime, _url)
    if (_pullTimerId) _clearInterval(_pullTimerId)
    _pullTimerId = _setInterval(_doPull, intervalMs)
  }

  function pullNow(): void {
    _doPull()
  }

  function stop(): void {
    if (_pullTimerId) {
      _clearInterval(_pullTimerId)
      _pullTimerId = null
    }
    if (_pushTimer) {
      _clearTimeout(_pushTimer)
      _pushTimer = null
    }
    _syncStatus = "disabled"
    config.onStatusChange("disabled", _lastSyncTime, _url)
  }

  _pullTimerId = _setInterval(_doPull, intervalMs)
  _doPull()

  return {
    markDirty,
    markDeleted,
    clearDeleted,
    pullNow,
    resolveFirstSync,
    stop,
  }
}