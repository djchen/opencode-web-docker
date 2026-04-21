#!/bin/sh
set -eu

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

has_env() {
  eval "[ \"\${$1+x}\" = x ]"
}

get_env() {
  eval "printf '%s' \"\${$1-}\""
}

trim() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

normalize_url() {
  trimmed="$(trim "$1")"
  if [ -z "$trimmed" ]; then
    printf '%s' ""
    return
  fi

  case "$trimmed" in
    http://*|https://*) with_scheme="$trimmed" ;;
    *) with_scheme="http://$trimmed" ;;
  esac

  printf '%s' "$with_scheme" | sed 's:/*$::'
}

encode_base64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

for legacy_var in OPENCODE_SERVER_URL OPENCODE_SERVER_NAME OPENCODE_SERVER_USERNAME OPENCODE_SERVER_PASSWORD; do
  if has_env "$legacy_var"; then
    die "Unsupported legacy variable $legacy_var detected. Migrate to indexed variables such as OPENCODE_SERVER_1_URL."
  fi
done

raw_indexes=""
for env_name in $(env | sed 's/=.*//'); do
  case "$env_name" in
    OPENCODE_SERVER_*_URL|OPENCODE_SERVER_*_NAME|OPENCODE_SERVER_*_USERNAME|OPENCODE_SERVER_*_PASSWORD)
      suffixless="${env_name#OPENCODE_SERVER_}"
      index="${suffixless%%_*}"
      case "$index" in
        ""|*[!0-9]*|0|0[0-9]*)
          die "Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: $env_name."
          ;;
      esac
      raw_indexes="$raw_indexes $index"
      ;;
  esac
done

if [ -z "$(trim "$raw_indexes")" ]; then
  die "OPENCODE_SERVER_1_URL is required."
fi

indexes="$(printf '%s' "$raw_indexes" | tr ' ' '\n' | sed '/^$/d' | sort -n -u)"
expected_index=1
max_index=0
for index in $indexes; do
  if [ "$index" -ne "$expected_index" ]; then
    die "Configured backend indexes must be contiguous starting at 1. Missing index $expected_index."
  fi

  url_var="OPENCODE_SERVER_${index}_URL"
  url_value="$(get_env "$url_var")"
  normalized_url="$(normalize_url "$url_value")"
  if [ -z "$normalized_url" ]; then
    die "$url_var is required and must not be empty after normalization."
  fi

  if [ -n "${normalized_urls-}" ] && printf '%s\n' "$normalized_urls" | grep -F -x -- "$normalized_url" >/dev/null 2>&1; then
    die "Duplicate configured backend URL after normalization: $normalized_url"
  fi

  if [ -n "${normalized_urls-}" ]; then
    normalized_urls="$(printf '%s\n%s' "$normalized_urls" "$normalized_url")"
  else
    normalized_urls="$normalized_url"
  fi
  max_index="$index"
  expected_index=$((expected_index + 1))
done

if has_env OPENCODE_FORCE_DEFAULT_SERVER; then
  force_default_raw="$(get_env OPENCODE_FORCE_DEFAULT_SERVER)"
else
force_default_raw="true"
fi
force_mode="force"
default_server_index="1"

case "$force_default_raw" in
  true)
    force_mode="force"
    default_server_index="1"
    ;;
  "")
    die "OPENCODE_FORCE_DEFAULT_SERVER must be true, false, or a configured numeric index."
    ;;
  false)
    force_mode="preserve"
    default_server_index="1"
    ;;
  *[!0-9]*)
    die "OPENCODE_FORCE_DEFAULT_SERVER must be true, false, or a configured numeric index."
    ;;
  *)
    if [ "$force_default_raw" -lt 1 ] || [ "$force_default_raw" -gt "$max_index" ]; then
      die "OPENCODE_FORCE_DEFAULT_SERVER=$force_default_raw is outside the configured backend range 1..$max_index."
    fi
    force_mode="force"
    default_server_index="$force_default_raw"
    ;;
esac

runtime_config_path="/home/sws/public/runtime-config.js"

cat > "$runtime_config_path" <<EOF
;(function () {
  var defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"
  var serverStoreKey = "opencode.global.dat:server"
  var forceDefaultMode = "${force_mode}"
  var configuredDefaultIndex = ${default_server_index}
  var configuredServers = [
EOF

index=1
while [ "$index" -le "$max_index" ]; do
  url_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_URL")")"
  name_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_NAME")")"
  username_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_USERNAME")")"
  password_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_PASSWORD")")"
  separator=","
  if [ "$index" -eq "$max_index" ]; then
    separator=""
  fi

  printf '    { url: "%s", name: "%s", username: "%s", password: "%s" }%s\n' \
    "$url_b64" "$name_b64" "$username_b64" "$password_b64" "$separator" >> "$runtime_config_path"
  index=$((index + 1))
done

cat >> "$runtime_config_path" <<'EOF'
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
EOF

exec "$@"
