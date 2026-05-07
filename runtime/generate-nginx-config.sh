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

ascii_lower() {
  printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

normalize_url() {
  trimmed="$(trim "$1")"
  if [ -z "$trimmed" ]; then
    printf '%s' ""
    return
  fi

  lower="$(ascii_lower "$trimmed")"
  case "$lower" in
    http://*|https://*)
      scheme="$(ascii_lower "$(printf '%s' "$trimmed" | sed 's|://.*||')")"
      rest="$(printf '%s' "$trimmed" | sed 's|^[^:]*://||')"
      ;;
    *)
      printf '%s' ""
      return
      ;;
  esac

  authority="$(printf '%s' "$rest" | sed 's|/.*$||')"
  host="$(ascii_lower "$(printf '%s' "$authority" | sed 's|:.*$||')")"
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

normalize_host() {
  trimmed="$(trim "$1")"
  if [ -z "$trimmed" ]; then
    printf '%s' ""
    return
  fi

  if printf '%s' "$trimmed" | LC_ALL=C grep '[^ -~]' >/dev/null 2>&1; then
    printf '%s' ""
    return
  fi

  lower="$(ascii_lower "$trimmed")"
  case "$lower" in
    *://*|*/*|*:*|*[[:space:]]*|*\**|.*|*.|*..*)
      printf '%s' ""
      return
      ;;
  esac

  old_ifs="$IFS"
  IFS=.
  for label in $lower; do
    case "$label" in
      ""|-*|*-|*[!a-z0-9-]*)
        IFS="$old_ifs"
        printf '%s' ""
        return
        ;;
    esac
  done
  IFS="$old_ifs"

  printf '%s' "$lower"
}

encode_base64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

runtime_root="/opt/opencode-web"
public_root="$runtime_root/public"
runtime_config_root="$runtime_root/runtime-configs"
runtime_bundle_path="$runtime_root/runtime/runtime-bundle.js"
nginx_template_path="$runtime_root/config/nginx.conf.template"
nginx_config_path="/etc/nginx/conf.d/default.conf"
nginx_servers_marker="# OPENCODE_WEB_GENERATED_SERVERS"

if [ ! -r "$runtime_bundle_path" ]; then
  die "Missing runtime bundle at $runtime_bundle_path"
fi
if [ ! -r "$nginx_template_path" ]; then
  die "Missing nginx config template at $nginx_template_path"
fi
if [ ! -d "$public_root" ]; then
  die "Missing public root at $public_root"
fi

raw_indexes=""
# Read null-delimited env entries so multiline values cannot inject bogus names.
# shellcheck disable=SC2016
env_names="$(env -0 | xargs -0 -n1 sh -c 'entry=$1; printf "%s\n" "${entry%%=*}"' sh)"
for env_name in $env_names; do
  case "$env_name" in
    SERVER_[0-9]*_HOST|SERVER_[0-9]*_BACKEND|SERVER_[0-9]*_NAME|SERVER_[0-9]*_APP_TITLE)
      suffixless="${env_name#SERVER_}"
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
  die "SERVER_1_HOST and SERVER_1_BACKEND are required."
fi

indexes="$(printf '%s' "$raw_indexes" | tr ' ' '\n' | sed '/^$/d' | sort -n -u)"
expected_index=1
max_index=0
normalized_hosts=""
for index in $indexes; do
  if [ "$index" -ne "$expected_index" ]; then
    die "Configured backend indexes must be contiguous starting at 1. Missing index $expected_index."
  fi

  host_var="SERVER_${index}_HOST"
  backend_var="SERVER_${index}_BACKEND"
  host_value="$(get_env "$host_var")"
  backend_value="$(get_env "$backend_var")"
  normalized_host="$(normalize_host "$host_value")"
  normalized_backend="$(normalize_url "$backend_value")"

  if [ -z "$normalized_host" ]; then
    die "$host_var is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs."
  fi
  if [ -z "$normalized_backend" ]; then
    die "$backend_var is required and must be an absolute http(s) URL."
  fi

  if [ -n "$normalized_hosts" ] && printf '%s\n' "$normalized_hosts" | grep -F -x -- "$normalized_host" >/dev/null 2>&1; then
    die "Duplicate configured host after normalization: $normalized_host"
  fi

  if [ -n "$normalized_hosts" ]; then
    normalized_hosts="$(printf '%s\n%s' "$normalized_hosts" "$normalized_host")"
  else
    normalized_hosts="$normalized_host"
  fi
  max_index="$index"
  expected_index=$((expected_index + 1))
done

write_runtime_config() {
  backend_url="$1"
  server_name="$2"
  app_title="$3"
  output_path="$4"
  url_b64="$(encode_base64 "$backend_url")"
  name_b64="$(encode_base64 "$server_name")"
  app_title_b64="$(encode_base64 "$app_title")"

  {
    cat <<'PREAMBLE'
function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}
PREAMBLE

    printf 'var configuredServer = {url:"%s",name:"%s"};\n' "$url_b64" "$name_b64"
    printf 'var appTitle = "%s";\n' "$app_title_b64"

    cat "$runtime_bundle_path"
  } > "$output_path"
}

write_no_store_headers() {
  cat <<EOF
  add_header Cache-Control "no-store, no-cache, must-revalidate" always;
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src * data:; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data: https:; media-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'" always;
EOF
}

write_asset_headers() {
  cat <<EOF
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src * data:; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data: https:; media-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'" always;
EOF
}

write_server_block() {
  host="$1"
  cat <<EOF

server {
  listen 80;
  listen [::]:80;
  server_name $host;
  root /opt/opencode-web/public;
  index index.html;
$(write_no_store_headers)

  location = /health {
    default_type text/plain;
    return 200 "ok\n";
  }

  location = /runtime-config.js {
    alias /opt/opencode-web/runtime-configs/$host.js;
  }

  location ^~ /assets/ {
$(write_asset_headers)
    try_files \$uri =404;
  }

  location ~ \\.[^/]+$ {
    try_files \$uri =404;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
EOF
}

rm -rf "$runtime_config_root"
mkdir -p "$runtime_config_root"

generated_servers_path="$(mktemp)"
trap 'rm -f "$generated_servers_path"' EXIT

index=1
while [ "$index" -le "$max_index" ]; do
  normalized_host="$(normalize_host "$(get_env "SERVER_${index}_HOST")")"
  normalized_backend="$(normalize_url "$(get_env "SERVER_${index}_BACKEND")")"
  server_name="$(get_env "SERVER_${index}_NAME")"
  app_title=""
  app_title_var="SERVER_${index}_APP_TITLE"
  if has_env "$app_title_var"; then
    app_title="$(get_env "$app_title_var")"
  fi

  write_runtime_config "$normalized_backend" "$server_name" "$app_title" "$runtime_config_root/$normalized_host.js"
  write_server_block "$normalized_host" >> "$generated_servers_path"

  index=$((index + 1))
done

if ! grep -F -x -- "$nginx_servers_marker" "$nginx_template_path" >/dev/null 2>&1; then
  die "Missing nginx server marker in $nginx_template_path"
fi

sed "/^$nginx_servers_marker$/r $generated_servers_path" "$nginx_template_path" | sed "/^$nginx_servers_marker$/d" > "$nginx_config_path"
