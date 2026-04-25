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

expect_generated_runtime_config_parses() {
  name="$1"
  shift

  printf '==> %s\n' "$name"
  runtime_config_js="$("$@")"
  printf '%s' "$runtime_config_js" | node -e 'process.stdin.setEncoding("utf8");let source="";process.stdin.on("data",(chunk)=>source+=chunk);process.stdin.on("end",()=>{new Function("return(async()=>{"+source+"})")});'
}

expect_failure \
  "reject missing OPENCODE_SERVER_URL" \
  "OPENCODE_SERVER_URL is required" \
  docker run --rm \
    "$image_tag" \
    true

expect_failure \
  "reject empty OPENCODE_SERVER_URL" \
  "OPENCODE_SERVER_URL is required and must not be empty after normalization." \
  docker run --rm \
    -e OPENCODE_SERVER_URL='   ' \
    "$image_tag" \
    true

expect_success \
  "generate a valid single-server runtime payload" \
  docker run --rm \
    -e OPENCODE_SERVER_URL=api1.example.com \
    -e OPENCODE_SERVER_NAME='Server\ 1' \
    -e OPENCODE_APP_TITLE='Hosted\ OpenCode' \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && test -s /opt/opencode-web/public/opencode-web-customizations.css && grep -F "var serverUrl = _b64d(" /opt/opencode-web/public/runtime-config.js >/dev/null && grep -F "var appTitle = _b64d(" /opt/opencode-web/public/runtime-config.js >/dev/null && ! grep -F "window.__OPENCODE_WRAP_SERVER_PROVIDER" /opt/opencode-web/public/runtime-config.js >/dev/null && ! grep -F "installDeferredServerProviderWrap" /opt/opencode-web/public/runtime-config.js >/dev/null'

expect_success \
  "generate runtime payload with settings sync" \
  docker run --rm \
    -e OPENCODE_SERVER_URL=api1.example.com \
    -e OPENCODE_SETTINGS_SYNC_URL=https://sync.example.com/settings \
    -e OPENCODE_SETTINGS_SYNC_INTERVAL=10 \
    -e OPENCODE_SETTINGS_SYNC_AUTH_HEADER="Bearer test-token" \
    "$image_tag" \
    sh -lc 'grep -F "var settingsSyncUrl = _b64d(" /opt/opencode-web/public/runtime-config.js >/dev/null && grep -F "var settingsSyncInterval = \"10\"" /opt/opencode-web/public/runtime-config.js >/dev/null && grep -F "var settingsSyncAuthHeader = _b64d(" /opt/opencode-web/public/runtime-config.js >/dev/null'

expect_generated_runtime_config_parses \
  "generated runtime-config.js parses as JavaScript and _b64d decodes correctly" \
  docker run --rm \
    -e OPENCODE_SERVER_URL=api1.example.com \
    -e OPENCODE_SERVER_NAME='Server\ 1' \
    -e OPENCODE_APP_TITLE='Hosted\ OpenCode' \
    "$image_tag" \
    sh -lc 'test -s /opt/opencode-web/public/runtime-config.js && cat /opt/opencode-web/public/runtime-config.js'

expect_success \
  "runtime-config.js base64-encoded values decode correctly" \
  docker run --rm \
    -e OPENCODE_SERVER_URL=api1.example.com \
    -e OPENCODE_SERVER_NAME='Server\ 1' \
    -e OPENCODE_APP_TITLE='Hosted\ OpenCode' \
    "$image_tag" \
    sh -lc 'js="/opt/opencode-web/public/runtime-config.js" && expected_url="$(printf "%s" "http://api1.example.com" | base64 | tr -d "\\n")" && expected_title="$(printf "%s" "Hosted OpenCode" | base64 | tr -d "\\n")" && expected_name="$(printf "%s" "Server 1" | base64 | tr -d "\\n")" && grep -F "var serverUrl = _b64d(\"${expected_url}\")" "$js" >/dev/null && grep -F "var appTitle = _b64d(\"${expected_title}\")" "$js" >/dev/null && grep -F "var serverName = _b64d(\"${expected_name}\")" "$js" >/dev/null'

printf '==> All runtime-config regression checks passed\n'