  ]

  function warnIncompatibleStore(reason) {
    console.warn(
      "OpenCode runtime-config may be incompatible with this upstream build:",
      reason,
      "Review runtime-config.sh against upstream app persistence.",
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
    try {
      var parsed = JSON.parse(localStorage.getItem(serverStoreKey) || "null")
      if (!parsed || typeof parsed !== "object") {
        if (parsed !== null) warnIncompatibleStore("server store is not an object")
        return { list: [], projects: {}, lastProject: {} }
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
      return parsed
    } catch {
      warnIncompatibleStore("failed to parse persisted server store JSON")
      return { list: [], projects: {}, lastProject: {} }
    }
  }

  function storedUrl(item) {
    if (typeof item === "string") return normalizeUrl(item)
    if (!item || typeof item !== "object") return ""
    if (item.type && item.http && typeof item.http.url === "string") return normalizeUrl(item.http.url)
    if (typeof item.url === "string") return normalizeUrl(item.url)
    return ""
  }

  function hasServer(list, url) {
    return list.some(function (item) {
      return storedUrl(item) === url
    })
  }

  try {
    var state = readState()
    var existingByUrl = Object.create(null)

    state.list.forEach(function (item) {
      var url = storedUrl(item)
      if (url && !existingByUrl[url]) existingByUrl[url] = item
    })

    var configuredUrls = Object.create(null)
    var mergedConfigured = configuredServers.map(function (server) {
      var serverUrl = normalizeUrl(decodeBase64(server.url))
      if (!serverUrl) return null

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

      return next
    }).filter(Boolean)

    if (!mergedConfigured.length) return

    state.list = mergedConfigured.concat(
      state.list.filter(function (item) {
        var url = storedUrl(item)
        return !url || !configuredUrls[url]
      }),
    )

    var persistedDefault = normalizeUrl(localStorage.getItem(defaultServerUrlKey) || "")
    var currentOrigin = normalizeUrl(location.origin)

    if (currentOrigin && !configuredUrls[currentOrigin]) {
      state.list = state.list.filter(function (item) {
        return storedUrl(item) !== currentOrigin
      })
      if (persistedDefault === currentOrigin) persistedDefault = ""
    }

    var bootstrapUrl = mergedConfigured[0].http.url
    var effectiveDefaultUrl = ""
    if (forceDefaultMode === "force") {
      effectiveDefaultUrl = mergedConfigured[configuredDefaultIndex - 1] ? mergedConfigured[configuredDefaultIndex - 1].http.url : ""
    } else if (persistedDefault && hasServer(state.list, persistedDefault)) {
      effectiveDefaultUrl = persistedDefault
    } else {
      effectiveDefaultUrl = mergedConfigured[configuredDefaultIndex - 1] ? mergedConfigured[configuredDefaultIndex - 1].http.url : ""
    }

    if (!effectiveDefaultUrl) return

    // Upstream prepends the bootstrap server ahead of the persisted store, so keep
    // this pinned to the first configured backend and let defaultServerUrl choose
    // which entry is selected on load.
    window.__OPENCODE_SERVER_URL = bootstrapUrl
    localStorage.setItem(serverStoreKey, JSON.stringify(state))

    if (forceDefaultMode === "force" || !persistedDefault || !hasServer(state.list, persistedDefault)) {
      localStorage.setItem(defaultServerUrlKey, effectiveDefaultUrl)
    }
  } catch (error) {
    console.warn("Failed to apply OpenCode runtime config", error)
  }
})()
