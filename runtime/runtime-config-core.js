var defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"
var serverStoreKey = "opencode.global.dat:server"

function normalizeUrl(url) {
  if (typeof url !== "string") return ""
  var trimmed = url.trim()
  if (!trimmed) return ""
  trimmed = trimmed.replace(/\/+$/, "")
  return trimmed
}

try {
  if (appTitle && typeof document === "object" && document) {
    document.title = appTitle
  }

  var raw = localStorage.getItem(serverStoreKey)
  var state = null
  try {
    state = JSON.parse(raw || "null")
  } catch (e) {
    state = null
  }

  var hadIncompatible = false

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    console.warn("OpenCode runtime-config: server store is not an object")
    state = { list: [], projects: {}, lastProject: {} }
    hadIncompatible = true
  }

  if (!Array.isArray(state.list)) {
    console.warn("OpenCode runtime-config: server store list is not an array")
    state.list = []
    hadIncompatible = true
  }
  if (!state.projects || typeof state.projects !== "object") {
    console.warn("OpenCode runtime-config: server store projects is not an object")
    state.projects = {}
    hadIncompatible = true
  }
  if (!state.lastProject || typeof state.lastProject !== "object") {
    console.warn("OpenCode runtime-config: server store lastProject is not an object")
    state.lastProject = {}
    hadIncompatible = true
  }

  var existingMatch = null
  var currentOrigin = normalizeUrl(location.origin)

  for (var i = 0; i < state.list.length; i++) {
    var item = state.list[i]
    var itemUrl = ""
    if (typeof item === "string") {
      itemUrl = normalizeUrl(item)
    } else if (item && typeof item === "object" && item.type === "http" && item.http && typeof item.http.url === "string") {
      itemUrl = normalizeUrl(item.http.url)
    } else if (item && typeof item === "object" && typeof item.url === "string") {
      itemUrl = normalizeUrl(item.url)
    }
    if (itemUrl === serverUrl && !existingMatch && typeof item === "object") {
      existingMatch = item
    }
  }

  var serverObj = {
    type: "http",
    http: { url: serverUrl },
  }
  if (existingMatch && typeof existingMatch === "object") {
    if (typeof existingMatch.displayName === "string") serverObj.displayName = existingMatch.displayName
    if (existingMatch.http && typeof existingMatch.http === "object") {
      if (typeof existingMatch.http.username === "string") serverObj.http.username = existingMatch.http.username
      if (typeof existingMatch.http.password === "string") serverObj.http.password = existingMatch.http.password
    }
  }
  if (serverName) serverObj.displayName = serverName
  if (serverUsername) serverObj.http.username = serverUsername
  if (serverPassword) serverObj.http.password = serverPassword

  var nextList = [serverObj]

  for (var i = 0; i < state.list.length; i++) {
    var item = state.list[i]
    var itemUrl = ""
    if (typeof item === "string") {
      itemUrl = normalizeUrl(item)
    } else if (item && typeof item === "object" && item.type === "http" && item.http && typeof item.http.url === "string") {
      itemUrl = normalizeUrl(item.http.url)
    } else if (item && typeof item === "object" && typeof item.url === "string") {
      itemUrl = normalizeUrl(item.url)
    }

    if (itemUrl === serverUrl) continue
    if (itemUrl === currentOrigin && currentOrigin !== serverUrl) continue
    nextList.push(item)
  }

  var nextState = {
    list: nextList,
    projects: state.projects,
    lastProject: state.lastProject,
  }
  var nextStateRaw = JSON.stringify(nextState)

  if (raw !== nextStateRaw) {
    localStorage.setItem(serverStoreKey, nextStateRaw)
  }

  var currentDefault = localStorage.getItem(defaultServerUrlKey)
  if (currentDefault !== serverUrl) {
    localStorage.setItem(defaultServerUrlKey, serverUrl)
  }

  window.__OPENCODE_SERVER_URL = serverUrl

  if (typeof initSettingsSync === "function" && settingsSyncUrl) {
    initSettingsSync(settingsSyncUrl, settingsSyncInterval, settingsSyncAuthHeader, settingsSyncUsername, settingsSyncPassword)
  }
} catch (error) {
  console.warn("Failed to apply OpenCode runtime config", error)
}