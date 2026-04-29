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

  lower="$(printf '%s' "$trimmed" | tr 'A-Z' 'a-z')"
  case "$lower" in
    http://*|https://*)
      scheme="$(printf '%s' "$trimmed" | sed 's|://.*||' | tr 'A-Z' 'a-z')"
      rest="$(printf '%s' "$trimmed" | sed 's|^[^:]*://||')"
      ;;
    *)
      scheme="http"
      rest="$trimmed"
      ;;
  esac

  authority="$(printf '%s' "$rest" | sed 's|/.*$||')"
  host="$(printf '%s' "$authority" | sed 's|:.*$||' | tr 'A-Z' 'a-z')"
  if [ -z "$host" ]; then
    printf '%s' ""
    return
  fi

  result="${scheme}://${host}"
  case "$authority" in
    *:*) result="${result}:$(printf '%s' "$authority" | sed 's|^[^:]*:||')" ;;
  esac
  case "$rest" in
    */*) result="${result}$(printf '%s' "$rest" | sed 's|[^/]*||')" ;;
  esac
  printf '%s' "$result" | sed 's:/*$::'
}

encode_base64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

runtime_root="/opt/opencode-web"
runtime_bundle_path="$runtime_root/runtime/runtime-bundle.js"
runtime_config_path="$runtime_root/public/runtime-config.js"
if [ ! -r "$runtime_bundle_path" ]; then
  die "Missing runtime bundle at $runtime_bundle_path"
fi

raw_indexes=""
# Read null-delimited env entries so multiline values cannot inject bogus names.
env_names="$(env -0 | xargs -0 -n1 sh -c 'entry=$1; printf "%s\n" "${entry%%=*}"' sh)"
for env_name in $env_names; do
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

raw_indexes="${raw_indexes# }"
if [ -z "$raw_indexes" ]; then
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
app_title_b64="$(encode_base64 "$(get_env OPENCODE_APP_TITLE)")"

case "$force_default_raw" in
  true)
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

server_entries=""
index=1
while [ "$index" -le "$max_index" ]; do
  url_value="$(printf '%s\n' "$normalized_urls" | sed -n "${index}p")"
  url_b64="$(encode_base64 "$url_value")"
  name_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_NAME")")"
  username_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_USERNAME")")"
  password_b64="$(encode_base64 "$(get_env "OPENCODE_SERVER_${index}_PASSWORD")")"

  entry="{url:\"${url_b64}\",name:\"${name_b64}\",username:\"${username_b64}\",password:\"${password_b64}\"}"
  if [ -z "$server_entries" ]; then
    server_entries="$entry"
  else
    server_entries="${server_entries},${entry}"
  fi
  index=$((index + 1))
done

{
  cat <<'PREAMBLE'
function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}
PREAMBLE

  printf 'var configuredServers = [%s];\n' "$server_entries"
  printf 'var forceDefaultMode = "%s";\n' "$force_mode"
  printf 'var configuredDefaultIndex = %s;\n' "$default_server_index"
  printf 'var appTitle = "%s";\n' "$app_title_b64"

  cat "$runtime_bundle_path"
} > "$runtime_config_path"

exec "$@"
