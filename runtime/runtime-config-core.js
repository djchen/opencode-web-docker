function warnIncompatibleStore(reason) {
  console.warn(
    "OpenCode runtime-config may be incompatible with this upstream build:",
    reason,
    "Review runtime/entrypoint.sh and runtime/runtime-config-core.js against upstream app persistence.",
  )
}

function decodeBase64(input) {
  if (!input) return ""
  var raw = atob(input)
  var bytes = new Uint8Array(raw.length)

  for (var i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }

  return new TextDecoder().decode(bytes)
}

function normalizeUrl(input) {
  var trimmed = (input || "").trim()
  if (!trimmed) return ""
  var withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : "http://" + trimmed
  return withProtocol.replace(/\/+$/, "")
}

function readState() {
  var raw = localStorage.getItem(serverStoreKey)

  try {
    var parsed = JSON.parse(raw || "null")
    if (!parsed || typeof parsed !== "object") {
      if (parsed !== null) warnIncompatibleStore("server store is not an object")
      return { raw: raw, state: { list: [], projects: {}, lastProject: {} } }
    }

    if (!Array.isArray(parsed.list)) {
      warnIncompatibleStore("server store list is not an array")
      parsed.list = []
    }
    if (!parsed.projects || typeof parsed.projects !== "object") {
      warnIncompatibleStore("server store projects is not an object")
      parsed.projects = {}
    }
    if (!parsed.lastProject || typeof parsed.lastProject !== "object") {
      warnIncompatibleStore("server store lastProject is not an object")
      parsed.lastProject = {}
    }

    return { raw: raw, state: parsed }
  } catch {
    warnIncompatibleStore("failed to parse persisted server store JSON")
    return { raw: raw, state: { list: [], projects: {}, lastProject: {} } }
  }
}

function storedUrl(item) {
  if (typeof item === "string") return normalizeUrl(item)
  if (!item || typeof item !== "object") return ""
  if (item.type && item.http && typeof item.http.url === "string") return normalizeUrl(item.http.url)
  if (typeof item.url === "string") return normalizeUrl(item.url)
  return ""
}

function buildExistingStateIndex(list) {
  var byUrl = Object.create(null)
  var entries = []

  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    var url = storedUrl(item)
    if (url && !byUrl[url]) byUrl[url] = item
    entries.push({ item: item, url: url })
  }

  return { byUrl: byUrl, entries: entries }
}

function buildConfiguredServers(existingByUrl) {
  var configuredUrls = Object.create(null)
  var mergedConfigured = []

  for (var i = 0; i < configuredServers.length; i++) {
    var server = configuredServers[i] || {}
    var serverUrl = normalizeUrl(decodeBase64(server.url))
    if (!serverUrl) continue

    configuredUrls[serverUrl] = true

    var existing = existingByUrl[serverUrl]
    var next = {
      type: "http",
      http: { url: serverUrl },
    }

    if (existing && typeof existing === "object") {
      if (typeof existing.displayName === "string") next.displayName = existing.displayName
      if (existing.http && typeof existing.http === "object") {
        if (typeof existing.http.username === "string") next.http.username = existing.http.username
        if (typeof existing.http.password === "string") next.http.password = existing.http.password
      }
    }

    var serverName = decodeBase64(server.name).trim()
    var serverUsername = decodeBase64(server.username).trim()
    var serverPassword = decodeBase64(server.password)

    if (serverName) next.displayName = serverName
    if (serverUsername) next.http.username = serverUsername
    if (serverPassword) next.http.password = serverPassword

    mergedConfigured.push(next)
  }

  return { configuredUrls: configuredUrls, mergedConfigured: mergedConfigured }
}

function listHasUrl(list, url) {
  for (var i = 0; i < list.length; i++) {
    if (storedUrl(list[i]) === url) return true
  }
  return false
}

try {
  var nextTitle = decodeBase64(appTitle).trim()
  if (nextTitle && typeof document === "object" && document) {
    document.title = nextTitle
  }

  var persisted = readState()
  var state = persisted.state
  var indexedState = buildExistingStateIndex(state.list)
  var merged = buildConfiguredServers(indexedState.byUrl)
  var configuredUrls = merged.configuredUrls
  var mergedConfigured = merged.mergedConfigured

  if (!mergedConfigured.length) return

  var currentOrigin = normalizeUrl(location.origin)
  var persistedDefaultRaw = localStorage.getItem(defaultServerUrlKey) || ""
  var persistedDefault = normalizeUrl(persistedDefaultRaw)
  var nextList = []

  for (var i = 0; i < indexedState.entries.length; i++) {
    var entry = indexedState.entries[i]
    if (entry.url && configuredUrls[entry.url]) continue
    if (currentOrigin && !configuredUrls[currentOrigin] && entry.url === currentOrigin) continue
    nextList.push(entry.item)
  }

  if (currentOrigin && !configuredUrls[currentOrigin] && persistedDefault === currentOrigin) {
    persistedDefault = ""
  }

  nextList = mergedConfigured.concat(nextList)

  var nextState = {
    list: nextList,
    projects: state.projects,
    lastProject: state.lastProject,
  }
  var nextStateRaw = JSON.stringify(nextState)
  var bootstrapUrl = mergedConfigured[0].http.url
  var configuredDefault = mergedConfigured[configuredDefaultIndex - 1]
  var fallbackDefaultUrl = configuredDefault ? configuredDefault.http.url : ""
  var effectiveDefaultUrl = ""

  if (forceDefaultMode === "force") {
    effectiveDefaultUrl = fallbackDefaultUrl
  } else if (persistedDefault && listHasUrl(nextList, persistedDefault)) {
    effectiveDefaultUrl = persistedDefault
  } else {
    effectiveDefaultUrl = fallbackDefaultUrl
  }

  if (!effectiveDefaultUrl) return

  // Upstream prepends the bootstrap server ahead of the persisted store, so keep
  // this pinned to the first configured backend and let defaultServerUrl choose
  // which entry is selected on load.
  window.__OPENCODE_SERVER_URL = bootstrapUrl

  if (persisted.raw !== nextStateRaw) {
    localStorage.setItem(serverStoreKey, nextStateRaw)
  }

  if (
    persistedDefaultRaw !== effectiveDefaultUrl &&
    (forceDefaultMode === "force" || !persistedDefault || !listHasUrl(nextList, persistedDefault))
  ) {
    localStorage.setItem(defaultServerUrlKey, effectiveDefaultUrl)
  }
} catch (error) {
  console.warn("Failed to apply OpenCode runtime config", error)
}
})()
