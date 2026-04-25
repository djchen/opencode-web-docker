#!/bin/sh
set -eu

die() {
  printf '%s\n' "$*" >&2
  exit 1
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

b64enc() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

runtime_root="/opt/opencode-web"
runtime_config_core_path="$runtime_root/runtime/runtime-config-core.js"
runtime_sync_client_path="$runtime_root/runtime/sync-client.js"
runtime_config_path="$runtime_root/public/runtime-config.js"

if [ ! -r "$runtime_config_core_path" ]; then
  die "Missing runtime-config core JS at $runtime_config_core_path"
fi
if [ ! -r "$runtime_sync_client_path" ]; then
  die "Missing sync client JS at $runtime_sync_client_path"
fi

server_url_raw="$(get_env OPENCODE_SERVER_URL)"
server_url="$(normalize_url "$server_url_raw")"
if [ -z "$server_url" ]; then
  die "OPENCODE_SERVER_URL is required and must not be empty after normalization."
fi

server_name="$(get_env OPENCODE_SERVER_NAME)"
server_username="$(get_env OPENCODE_SERVER_USERNAME)"
server_password="$(get_env OPENCODE_SERVER_PASSWORD)"
app_title="$(get_env OPENCODE_APP_TITLE)"
settings_sync_url="$(get_env OPENCODE_SETTINGS_SYNC_URL)"
settings_sync_interval="$(get_env OPENCODE_SETTINGS_SYNC_INTERVAL)"
settings_sync_auth_header="$(get_env OPENCODE_SETTINGS_SYNC_AUTH_HEADER)"
settings_sync_username="$(get_env OPENCODE_SETTINGS_SYNC_USERNAME)"
settings_sync_password="$(get_env OPENCODE_SETTINGS_SYNC_PASSWORD)"

server_url_b64="$(b64enc "$server_url")"
server_name_b64="$(b64enc "$server_name")"
server_username_b64="$(b64enc "$server_username")"
server_password_b64="$(b64enc "$server_password")"
app_title_b64="$(b64enc "$app_title")"
settings_sync_url_b64="$(b64enc "$settings_sync_url")"
settings_sync_auth_header_b64="$(b64enc "$settings_sync_auth_header")"
settings_sync_username_b64="$(b64enc "$settings_sync_username")"
settings_sync_password_b64="$(b64enc "$settings_sync_password")"

cat > "$runtime_config_path" <<EOF
function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}
var serverUrl = _b64d("${server_url_b64}")
var serverName = _b64d("${server_name_b64}")
var serverUsername = _b64d("${server_username_b64}")
var serverPassword = _b64d("${server_password_b64}")
var appTitle = _b64d("${app_title_b64}")
var settingsSyncUrl = _b64d("${settings_sync_url_b64}")
var settingsSyncInterval = "${settings_sync_interval:-30}"
var settingsSyncAuthHeader = _b64d("${settings_sync_auth_header_b64}")
var settingsSyncUsername = _b64d("${settings_sync_username_b64}")
var settingsSyncPassword = _b64d("${settings_sync_password_b64}")
EOF

cat "$runtime_config_core_path" >> "$runtime_config_path"
printf '\n' >> "$runtime_config_path"
cat "$runtime_sync_client_path" >> "$runtime_config_path"

exec "$@"