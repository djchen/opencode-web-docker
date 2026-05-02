#!/bin/sh
# shellcheck disable=SC2016
set -eu

usage() {
  printf '%s\n' "usage: ./scripts/test-runtime-config.sh [--build] [image-tag]" >&2
  exit 1
}

script_dir=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)

build_image=false
image_tag="opencode-web-docker"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      build_image=true
      ;;
    --help|-h)
      usage
      ;;
    -*)
      usage
      ;;
    *)
      image_tag="$1"
      ;;
  esac
  shift
done

if [ "$build_image" = true ]; then
  printf '==> Building Docker image %s\n' "$image_tag"
  docker build -t "$image_tag" "$repo_root"
elif ! docker image inspect "$image_tag" >/dev/null 2>&1; then
  printf 'Docker image %s not found. Build it first or pass --build.\n' "$image_tag" >&2
  exit 1
fi

expect_failure() {
  name="$1"
  expected_message="$2"
  shift 2

  printf '==> %s\n' "$name"
  if output=$("$@" 2>&1); then
    printf 'Expected failure, but command succeeded for: %s\n' "$name" >&2
    exit 1
  fi

  printf '%s\n' "$output"

  if ! printf '%s' "$output" | grep -F -- "$expected_message" >/dev/null 2>&1; then
    printf 'Expected message not found for: %s\n' "$name" >&2
    printf 'Expected: %s\n' "$expected_message" >&2
    exit 1
  fi
}

expect_success() {
  name="$1"
  shift

  printf '==> %s\n' "$name"
  "$@"
}

expect_final_image_layout() {
  name="$1"
  shift

  printf '==> %s\n' "$name"
  "$@" sh -lc '
    test -f /opt/opencode-web/config/nginx.conf.template &&
    test ! -e /opt/opencode-web/config/config &&
    test -f /opt/opencode-web/public/index.html &&
    test -f /opt/opencode-web/runtime/generate-nginx-config.sh &&
    test -x /docker-entrypoint.d/40-opencode-web.sh &&
    test -f /opt/opencode-web/runtime/runtime-bundle.js
  '
}

with_nginx_container() {
  name="$1"
  shift

  printf '==> %s\n' "$name"
  container_id="$(docker run -d "$@")"
  trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT HUP INT TERM
  for _ in 1 2 3 4 5 6 7 8 9; do
    if docker exec "$container_id" wget -q --spider http://127.0.0.1/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "$container_id" >&2 || true
  printf 'nginx did not become healthy for: %s\n' "$name" >&2
  exit 1
}

stop_nginx_container() {
  docker rm -f "$container_id" >/dev/null 2>&1 || true
  trap - EXIT HUP INT TERM
}

expect_generated_runtime_config_parses() {
  name="$1"
  shift

  printf '==> %s\n' "$name"
  runtime_config_js="$("$@")"
  printf '%s' "$runtime_config_js" | node -e 'process.stdin.setEncoding("utf8");let source="";process.stdin.on("data",(chunk)=>source+=chunk);process.stdin.on("end",()=>{new Function(source)})'
}

expect_generated_runtime_config_applies() {
  name="$1"
  expected_title="$2"
  expected_bootstrap_url="$3"
  expected_default_url="$4"
  expected_list_json="$5"
  shift 5

  printf '==> %s\n' "$name"
  runtime_config_js="$("$@")"
  printf '%s' "$runtime_config_js" | node -e '
    const vm = require("node:vm")
    const [expectedTitle, expectedBootstrapUrl, expectedDefaultUrl, expectedListJson] = process.argv.slice(1)
    let source = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => (source += chunk))
    process.stdin.on("end", () => {
      const storage = new Map()
      const context = {
        Buffer,
        JSON,
        TextDecoder,
        Uint8Array,
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        console,
        document: { title: "OpenCode" },
        location: { origin: "http://frontend.opencode.example.com" },
        localStorage: {
          getItem: (key) => (storage.has(key) ? storage.get(key) : null),
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
        window: {},
      }

      vm.runInNewContext(source, context, { timeout: 1000 })

      const savedStateRaw = storage.get("opencode.global.dat:server")
      if (!savedStateRaw) throw new Error("Missing persisted server state")

      const savedState = JSON.parse(savedStateRaw)
      const savedList = savedState.list.map((item) => ({
        url: item.http?.url ?? item.url,
        name: item.displayName ?? "",
      }))

      if (context.document.title !== expectedTitle) {
        throw new Error(`Expected document.title=${JSON.stringify(expectedTitle)}, got ${JSON.stringify(context.document.title)}`)
      }
      if (context.window.__OPENCODE_SERVER_URL !== expectedBootstrapUrl) {
        throw new Error(`Expected bootstrap URL ${JSON.stringify(expectedBootstrapUrl)}, got ${JSON.stringify(context.window.__OPENCODE_SERVER_URL)}`)
      }
      if (storage.get("opencode.settings.dat:defaultServerUrl") !== expectedDefaultUrl) {
        throw new Error(`Expected default server URL ${JSON.stringify(expectedDefaultUrl)}, got ${JSON.stringify(storage.get("opencode.settings.dat:defaultServerUrl"))}`)
      }

      const expectedList = JSON.parse(expectedListJson)
      if (JSON.stringify(savedList) !== JSON.stringify(expectedList)) {
        throw new Error(`Expected server list ${expectedListJson}, got ${JSON.stringify(savedList)}`)
      }
    })
  ' "$expected_title" "$expected_bootstrap_url" "$expected_default_url" "$expected_list_json"
}

expect_failure \
  "reject legacy URL-only configuration" \
  "SERVER_1_HOST and SERVER_1_BACKEND are required." \
  docker run --rm \
    -e SERVER_1_URL=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject malformed indexed env names" \
  "Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_1FOO_HOST." \
  docker run --rm \
    -e SERVER_1FOO_HOST=x \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject padded backend indexes" \
  "Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_01_HOST." \
  docker run --rm \
    -e SERVER_01_HOST=web1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject non-contiguous backend indexes" \
  "Configured backend indexes must be contiguous starting at 1. Missing index 2." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    -e SERVER_3_HOST=web3.opencode.example.com \
    -e SERVER_3_BACKEND=http://api3.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject missing host" \
  "SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs." \
  docker run --rm \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject missing backend" \
  "SERVER_1_BACKEND is required and must be an absolute http(s) URL." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject protocol in host" \
  "SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs." \
  docker run --rm \
    -e SERVER_1_HOST=https://web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject port in host" \
  "SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com:8080 \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject path in host" \
  "SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com/app \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject direct unicode IDN host" \
  "SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs." \
  docker run --rm \
    -e SERVER_1_HOST=täst.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject duplicate hosts" \
  "Duplicate configured host after normalization: web1.opencode.example.com" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    -e SERVER_2_HOST=web1.opencode.example.com \
    -e SERVER_2_BACKEND=http://api2.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject case-variant duplicate hosts" \
  "Duplicate configured host after normalization: web1.opencode.example.com" \
  docker run --rm \
    -e SERVER_1_HOST=Web1.OpenCode.Example.Com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    -e SERVER_2_HOST=web1.opencode.example.com \
    -e SERVER_2_BACKEND=http://api2.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject backend without scheme" \
  "SERVER_1_BACKEND is required and must be an absolute http(s) URL." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=api1.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

expect_failure \
  "reject backend with empty host after scheme" \
  "SERVER_1_BACKEND is required and must be an absolute http(s) URL." \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND='http://' \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh'

multiline_env_value="$(printf 'before\nSERVER_9_HOST\nafter')"

expect_final_image_layout \
  "final image layout is sane" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    "$image_tag"

expect_success \
  "ignore multiline env values while scanning backend vars" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    -e "UNRELATED_MULTILINE=$multiline_env_value" \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test ! -e /opt/opencode-web/public/runtime-config.js'

expect_success \
  "generate valid host-based runtime payloads" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=https://api1.opencode.example.com \
    -e SERVER_1_NAME=Server\ 1 \
    -e SERVER_1_APP_TITLE=Server\ 1\ Web \
    -e SERVER_2_HOST=web2.opencode.example.com \
    -e SERVER_2_BACKEND=https://api2.opencode.example.com/ \
    -e SERVER_2_APP_TITLE=Server\ 2\ Web \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test -s /opt/opencode-web/runtime-configs/web2.opencode.example.com.js && test -s /etc/nginx/conf.d/default.conf && test ! -e /opt/opencode-web/public/runtime-config.js && test -d /opt/opencode-web/public/assets && test -s /opt/opencode-web/public/opencode-web-customizations.css && ! grep -F "<style id=\"opencode-web-customizations\"" /opt/opencode-web/public/index.html >/dev/null && grep -F "<link rel=\"stylesheet\" href=\"/opencode-web-customizations.css\">" /opt/opencode-web/public/index.html >/dev/null'

expect_success \
  "runtime config generation is idempotent" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api1.opencode.example.com \
    -e SERVER_2_HOST=web2.opencode.example.com \
    -e SERVER_2_BACKEND=http://api2.opencode.example.com \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test "$(grep -c "server_name web" /etc/nginx/conf.d/default.conf)" -eq 2'

expect_generated_runtime_config_applies \
  "server 1 runtime-config applies only server 1" \
  "Server 1 Web" \
  "https://api1.opencode.example.com" \
  "https://api1.opencode.example.com" \
  '[{"url":"https://api1.opencode.example.com","name":"Server 1"}]' \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=https://api1.opencode.example.com \
    -e SERVER_1_NAME=Server\ 1 \
    -e SERVER_1_APP_TITLE=Server\ 1\ Web \
    -e SERVER_2_HOST=web2.opencode.example.com \
    -e SERVER_2_BACKEND=https://api2.opencode.example.com/ \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web1.opencode.example.com.js'

expect_generated_runtime_config_applies \
  "server 2 runtime-config applies only server 2" \
  "Server 2 Web" \
  "https://api2.opencode.example.com" \
  "https://api2.opencode.example.com" \
  '[{"url":"https://api2.opencode.example.com","name":"Server 2"}]' \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=https://api1.opencode.example.com \
    -e SERVER_1_NAME=Server\ 1 \
    -e SERVER_2_HOST=web2.opencode.example.com \
    -e SERVER_2_BACKEND=https://api2.opencode.example.com/ \
    -e SERVER_2_NAME=Server\ 2 \
    -e SERVER_1_APP_TITLE=Server\ 1\ Web \
    -e SERVER_2_APP_TITLE=Server\ 2\ Web \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web2.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web2.opencode.example.com.js'

expect_generated_runtime_config_applies \
  "generated runtime-config preserves unicode metadata" \
  "你好 OpenCode" \
  "https://api1.opencode.example.com" \
  "https://api1.opencode.example.com" \
  '[{"url":"https://api1.opencode.example.com","name":"München"}]' \
  docker run --rm \
    -e SERVER_1_HOST=xn--tst-qla.example.com \
    -e SERVER_1_BACKEND=https://api1.opencode.example.com \
    -e SERVER_1_NAME=München \
    -e SERVER_1_APP_TITLE=你好\ OpenCode \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/xn--tst-qla.example.com.js && cat /opt/opencode-web/runtime-configs/xn--tst-qla.example.com.js'

expect_generated_runtime_config_parses \
  "generated runtime-config.js parses as JavaScript" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=https://api1.opencode.example.com \
    -e SERVER_1_NAME=Server\ 1 \
    -e SERVER_1_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web1.opencode.example.com.js'

expect_generated_runtime_config_applies \
  "normalizes uppercase scheme and hostname to lowercase" \
  "OpenCode" \
  "https://api1.opencode.example.com" \
  "https://api1.opencode.example.com" \
  '[{"url":"https://api1.opencode.example.com","name":""}]' \
  docker run --rm \
    -e SERVER_1_HOST=WEB1.OPENCODE.EXAMPLE.COM \
    -e SERVER_1_BACKEND=HTTPS://API1.OPENCODE.EXAMPLE.COM \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web1.opencode.example.com.js'

expect_generated_runtime_config_applies \
  "preserves URL path case while normalizing scheme and host" \
  "OpenCode" \
  "https://api.opencode.example.com/pAtH" \
  "https://api.opencode.example.com/pAtH" \
  '[{"url":"https://api.opencode.example.com/pAtH","name":""}]' \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=HTTPS://API.OPENCODE.EXAMPLE.COM/pAtH \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web1.opencode.example.com.js'

expect_generated_runtime_config_applies \
  "preserves port while normalizing scheme and host" \
  "OpenCode" \
  "http://api.opencode.example.com:8080" \
  "http://api.opencode.example.com:8080" \
  '[{"url":"http://api.opencode.example.com:8080","name":""}]' \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=HTTP://API.OPENCODE.EXAMPLE.COM:8080 \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && cat /opt/opencode-web/runtime-configs/web1.opencode.example.com.js'

expect_success \
  "allow duplicate backend URLs across hosts" \
  docker run --rm \
    -e SERVER_1_HOST=web1.opencode.example.com \
    -e SERVER_1_BACKEND=http://api.opencode.example.com \
    -e SERVER_2_HOST=web2.opencode.example.com \
    -e SERVER_2_BACKEND=http://api.opencode.example.com/ \
    "$image_tag" \
    sh -lc '/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test -s /opt/opencode-web/runtime-configs/web2.opencode.example.com.js'

with_nginx_container \
  "nginx starts through official entrypoint" \
  -e SERVER_1_HOST=web1.opencode.example.com \
  -e SERVER_1_BACKEND=http://api1.opencode.example.com \
  -e SERVER_2_HOST=web2.opencode.example.com \
  -e SERVER_2_BACKEND=http://api2.opencode.example.com \
  "$image_tag"

expect_generated_runtime_config_applies \
  "nginx serves host 1 runtime config" \
  "OpenCode" \
  "http://api1.opencode.example.com" \
  "http://api1.opencode.example.com" \
  '[{"url":"http://api1.opencode.example.com","name":""}]' \
  docker exec "$container_id" wget -q --header="Host: web1.opencode.example.com" -O - http://127.0.0.1/runtime-config.js

expect_generated_runtime_config_applies \
  "nginx serves host 2 runtime config" \
  "OpenCode" \
  "http://api2.opencode.example.com" \
  "http://api2.opencode.example.com" \
  '[{"url":"http://api2.opencode.example.com","name":""}]' \
  docker exec "$container_id" wget -q --header="Host: web2.opencode.example.com" -O - http://127.0.0.1/runtime-config.js

expect_generated_runtime_config_applies \
  "nginx matches server when Host includes port" \
  "OpenCode" \
  "http://api2.opencode.example.com" \
  "http://api2.opencode.example.com" \
  '[{"url":"http://api2.opencode.example.com","name":""}]' \
  docker exec "$container_id" wget -q --header="Host: web2.opencode.example.com:80" -O - http://127.0.0.1/runtime-config.js

expect_success \
  "nginx unmatched host returns 404 except health" \
  docker exec "$container_id" sh -lc '
    wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1/health &&
    ! wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1/runtime-config.js &&
    ! wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1/future/opencode/route
  '

expect_success \
  "nginx configured host SPA route returns app shell" \
  docker exec "$container_id" sh -lc 'wget -q --header="Host: web2.opencode.example.com" -O - http://127.0.0.1/future/opencode/route | grep -q "/runtime-config.js"'

expect_success \
  "nginx missing static file returns 404" \
  docker exec "$container_id" sh -lc '! wget -q --spider --header="Host: web2.opencode.example.com" http://127.0.0.1/missing.js'

expect_success \
  "configured host app shell has no-store and CSP headers" \
  docker exec "$container_id" sh -lc '
    headers="$(wget -qS --header="Host: web1.opencode.example.com" -O /dev/null http://127.0.0.1/ 2>&1)"
    printf "%s\n" "$headers" | grep -qi "cache-control.*no-store" && printf "%s\n" "$headers" | grep -qi "content-security-policy"
  '

expect_success \
  "hashed assets have long-lived cache headers" \
  docker exec "$container_id" sh -lc '
    set -- /opt/opencode-web/public/assets/*
    asset="${1##*/}"
    headers="$(wget -qS --header="Host: web1.opencode.example.com" -O /dev/null "http://127.0.0.1/assets/$asset" 2>&1)"
    printf "%s\n" "$headers" | grep -qi "cache-control.*immutable" && printf "%s\n" "$headers" | grep -qi "content-security-policy"
  '

stop_nginx_container
printf '==> All runtime-config regression checks passed\n'
