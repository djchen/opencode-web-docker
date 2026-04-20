#!/bin/sh
set -eu

: "${OPENCODE_SERVER_URL:?OPENCODE_SERVER_URL is required}"
export OPENCODE_FORCE_DEFAULT_SERVER="${OPENCODE_FORCE_DEFAULT_SERVER-true}"
: "${OPENCODE_SERVER_NAME:=}"
: "${OPENCODE_SERVER_USERNAME:=}"
: "${OPENCODE_SERVER_PASSWORD:=}"

OPENCODE_SERVER_URL_B64="$(printf '%s' "$OPENCODE_SERVER_URL" | base64 | tr -d '\n')"
export OPENCODE_SERVER_URL_B64
OPENCODE_SERVER_NAME_B64="$(printf '%s' "$OPENCODE_SERVER_NAME" | base64 | tr -d '\n')"
export OPENCODE_SERVER_NAME_B64
OPENCODE_SERVER_USERNAME_B64="$(printf '%s' "$OPENCODE_SERVER_USERNAME" | base64 | tr -d '\n')"
export OPENCODE_SERVER_USERNAME_B64
OPENCODE_SERVER_PASSWORD_B64="$(printf '%s' "$OPENCODE_SERVER_PASSWORD" | base64 | tr -d '\n')"
export OPENCODE_SERVER_PASSWORD_B64

cat > /home/sws/public/runtime-config.js <<EOF
;(function () {
  var defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"
  var serverStoreKey = "opencode.global.dat:server"

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
    var trimmed = input.trim()
    if (!trimmed) return ""
    var withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : "http://" + trimmed
    return withProtocol.replace(/\/+$/, "")
  }

  function looksTrue(input) {
    return /^(1|true|yes|on)$/i.test(input)
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

  try {
    var serverUrl = normalizeUrl(decodeBase64("$OPENCODE_SERVER_URL_B64"))
    if (!serverUrl) return

    window.__OPENCODE_SERVER_URL = serverUrl

    var serverName = decodeBase64("$OPENCODE_SERVER_NAME_B64").trim()
    var serverUsername = decodeBase64("$OPENCODE_SERVER_USERNAME_B64").trim()
    var serverPassword = decodeBase64("$OPENCODE_SERVER_PASSWORD_B64")
    var forceDefaultServer = looksTrue("$OPENCODE_FORCE_DEFAULT_SERVER")

    var state = readState()
    var existing = state.list.find(function (item) {
      return storedUrl(item) === serverUrl
    })
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

    if (serverName) next.displayName = serverName
    if (serverUsername) next.http.username = serverUsername
    if (serverPassword) next.http.password = serverPassword

    state.list = [next].concat(
      state.list.filter(function (item) {
        return storedUrl(item) !== serverUrl
      }),
    )

    var currentOrigin = normalizeUrl(location.origin)
    if (currentOrigin && currentOrigin !== serverUrl) {
      state.list = state.list.filter(function (item) {
        return storedUrl(item) !== currentOrigin
      })
      if (localStorage.getItem(defaultServerUrlKey) === currentOrigin) {
        localStorage.setItem(defaultServerUrlKey, serverUrl)
      }
    }

    localStorage.setItem(serverStoreKey, JSON.stringify(state))

    if (forceDefaultServer || !localStorage.getItem(defaultServerUrlKey)) {
      localStorage.setItem(defaultServerUrlKey, serverUrl)
    }
  } catch (error) {
    console.warn("Failed to apply OpenCode runtime config", error)
  }
})()
EOF

exec "$@"
