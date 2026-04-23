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
  printf '%s' "$runtime_config_js" | bun -e 'new Function(await Bun.stdin.text())'
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

multiline_env_value="$(printf 'before\nOPENCODE_SERVER_9_URL\nafter')"

expect_success \
  "ignore multiline env values while scanning backend vars" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=http://api1.example.com \
    -e "UNRELATED_MULTILINE=$multiline_env_value" \
    "$image_tag" \
    sh -lc 'test -s /home/sws/public/runtime-config.js'

expect_success \
  "generate a valid multi-backend runtime payload" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api1.example.com \
    -e OPENCODE_SERVER_1_NAME=Server\ 1 \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /home/sws/public/runtime-config.js && test -s /home/sws/public/opencode-web-customizations.css && grep -F "var configuredDefaultIndex = 2" /home/sws/public/runtime-config.js >/dev/null && grep -F "var forceDefaultMode = \"force\"" /home/sws/public/runtime-config.js >/dev/null && grep -F "window.__OPENCODE_SERVER_URL = bootstrapUrl" /home/sws/public/runtime-config.js >/dev/null && grep -F "var bootstrapUrl = mergedConfigured[0].http.url" /home/sws/public/runtime-config.js >/dev/null && grep -F "var appTitle = \"SG9zdGVkIE9wZW5Db2Rl\"" /home/sws/public/runtime-config.js >/dev/null && ! grep -F "window.__OPENCODE_SERVER_URL = effectiveDefaultUrl" /home/sws/public/runtime-config.js >/dev/null && ! grep -F "index:" /home/sws/public/runtime-config.js >/dev/null && ! grep -F "<style id=\"opencode-web-customizations\"" /home/sws/public/index.html >/dev/null && grep -F "<link rel=\"stylesheet\" href=\"/opencode-web-customizations.css\">" /home/sws/public/index.html >/dev/null'

expect_generated_runtime_config_parses \
  "generated runtime-config.js parses as JavaScript" \
  docker run --rm \
    -e OPENCODE_SERVER_1_URL=api1.example.com \
    -e OPENCODE_SERVER_1_NAME=Server\ 1 \
    -e OPENCODE_SERVER_2_URL=https://api2.example.com/ \
    -e OPENCODE_FORCE_DEFAULT_SERVER=2 \
    -e OPENCODE_APP_TITLE=Hosted\ OpenCode \
    "$image_tag" \
    sh -lc 'test -s /home/sws/public/runtime-config.js && cat /home/sws/public/runtime-config.js'

printf '==> All runtime-config regression checks passed\n'
