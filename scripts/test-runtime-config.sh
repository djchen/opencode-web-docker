#!/bin/sh
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
    test -f /opt/opencode-web/config/sws.toml &&
    test ! -e /opt/opencode-web/config/config &&
    test -f /opt/opencode-web/public/index.html &&
    test -f /opt/opencode-web/runtime/entrypoint.sh &&
    test -f /opt/opencode-web/runtime/runtime-bundle.js
  '
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
        location: { origin: "http://frontend.example.com" },
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
        username: item.http?.username ?? "",
        password: item.http?.password ?? "",
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
  "reject malformed indexed env names" \
  "Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: OPENCODE_SERVER_1FOO_URL." \
  docker run --rm \
    -e OPENCODE_SERVER_1FOO_URL=x \
    "$image_tag" \
    true

expect_failure \
  "reject invalid force-default values" \
  "OPENCODE_FORCE_DEFAULT_SERVER must be true, false, or a configured numeric index." \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=x \
    -e OPENCODE_FORCE_DEFAULT_SERVER=yes \
    "$image_tag" \
    true

expect_failure \
  "reject duplicate normalized backend URLs" \
  "Duplicate configured backend URL after normalization: http://api.example.com" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api.example.com/ \
    -e OPENCODE_SERVER_2_URL=http://api.example.com \
    "$image_tag" \
    true

expect_failure \
  "reject padded backend indexes" \
  "Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: OPENCODE_SERVER_01_URL." \
  docker run --rm \
    -e OPENCODE_SERVER_01_URL=http://api1.example.com \
    "$image_tag" \
    true

expect_failure \
  "reject non-contiguous backend indexes" \
  "Configured backend indexes must be contiguous starting at 1. Missing index 2." \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    -e OPENCODE_SERVER_3_URL=http://api3.example.com \
    "$image_tag" \
    true

expect_failure \
  "reject empty required backend URLs" \
  "OPENCODE_SERVER_1_URL is required and must not be empty after normalization." \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL='   ' \
    "$image_tag" \
    true

expect_failure \
  "reject URL with empty host after scheme" \
  "OPENCODE_SERVER_1_URL is required and must not be empty after normalization." \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL='http://' \
    "$image_tag" \
    true

expect_failure \
  "reject URL with empty host after https scheme" \
  "OPENCODE_SERVER_1_URL is required and must not be empty after normalization." \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL='https://' \
    "$image_tag" \
    true

multiline_env_value="$(printf 'before\nOPENCODE_SERVER_9_URL\nafter')"

expect_final_image_layout \
  "final image layout is sane" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    "$image_tag"

expect_success \
  "ignore multiline env values while scanning backend vars" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    -e "UNRELATED_MULTILINE=$multiline_env_value" \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js'

expect_success \
  "generate a valid multi-backend runtime payload" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api1.example.com \
    -e OPENCODE_SERVER_1_NAME=Server\ 1 \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && test -s /opt/opencode-web/public/opencode-web-customizations.css && ! grep -F "<style id=\"opencode-web-customizations\"" /opt/opencode-web/public/index.html >/dev/null && grep -F "<link rel=\"stylesheet\" href=\"/opencode-web-customizations.css\">" /opt/opencode-web/public/index.html >/dev/null'

expect_generated_runtime_config_applies \
  "generated runtime-config applies expected multi-backend state" \
  "Hosted OpenCode" \
  "http://api1.example.com" \
  "https://api2.example.com" \
  '[{"url":"http://api1.example.com","name":"Server 1","username":"","password":""},{"url":"https://api2.example.com","name":"","username":"","password":""}]' \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api1.example.com \
    -e OPENCODE_SERVER_1_NAME=Server\ 1 \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_generated_runtime_config_applies \
  "generated runtime-config preserves unicode metadata" \
  "你好 OpenCode" \
  "https://api1.example.com" \
  "https://api2.example.com" \
  '[{"url":"https://api1.example.com","name":"München","username":"álîcè","password":"pässwörd"},{"url":"https://api2.example.com","name":"東京","username":"","password":""}]' \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=https://api1.example.com \
    -e OPENCODE_SERVER_1_NAME=München \
    -e OPENCODE_SERVER_1_USERNAME=álîcè \
    -e OPENCODE_SERVER_1_PASSWORD=pässwörd \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_SERVER_2_NAME=東京 \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=你好\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_generated_runtime_config_parses \
  "generated runtime-config.js parses as JavaScript" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api1.example.com \
    -e OPENCODE_SERVER_1_NAME=Server\ 1 \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_generated_runtime_config_applies \
  "normalizes uppercase scheme and hostname to lowercase" \
  "OpenCode" \
  "https://api1.example.com" \
  "https://api2.example.com" \
  '[{"url":"https://api1.example.com","name":"","username":"","password":""},{"url":"https://api2.example.com","name":"","username":"","password":""}]' \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=HTTPS://API1.EXAMPLE.COM \
    -e OPENCODE_SERVER_2_URL=HTTPS://API2.EXAMPLE.COM/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_generated_runtime_config_applies \
  "preserves URL path case while normalizing scheme and host" \
  "OpenCode" \
  "https://api.example.com/pAtH" \
  "https://api.example.com/pAtH" \
  '[{"url":"https://api.example.com/pAtH","name":"","username":"","password":""}]' \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=HTTPS://API.EXAMPLE.COM/pAtH \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_generated_runtime_config_applies \
  "preserves port while normalizing scheme and host" \
  "OpenCode" \
  "http://api.example.com:8080" \
  "http://api.example.com:8080" \
  '[{"url":"http://api.example.com:8080","name":"","username":"","password":""}]' \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=HTTP://API.EXAMPLE.COM:8080 \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_success \
  "SPA fallback route has no-cache and CSP headers" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    "$image_tag" \
    sh -lc 'static-web-server -w /opt/opencode-web/config/sws.toml &
      for i in 1 2 3 4 5; do wget -q --spider http://127.0.0.1:8080/ && break; sleep 1; done
      headers="$(wget -qS -O /dev/null http://127.0.0.1:8080/some/spa/route 2>&1)"
      printf "%s\n" "$headers" | grep -qi "cache-control.*no-store" && printf "%s\n" "$headers" | grep -qi "content-security-policy"'

expect_success \
  "hashed assets have long-lived cache headers" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    "$image_tag" \
    sh -lc 'static-web-server -w /opt/opencode-web/config/sws.toml &
      for i in 1 2 3 4 5; do wget -q --spider http://127.0.0.1:8080/ && break; sleep 1; done
      asset="$(ls /opt/opencode-web/public/assets/ | head -1)"
      headers="$(wget -qS -O /dev/null "http://127.0.0.1:8080/assets/$asset" 2>&1)"
      printf "%s\n" "$headers" | grep -qi "cache-control.*immutable" && printf "%s\n" "$headers" | grep -qi "content-security-policy"'

printf '==> All runtime-config regression checks passed\n'
