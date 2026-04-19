#!/bin/sh
set -eu

tag="${1:-}"

git submodule sync --recursive opencode
git submodule update --init --recursive opencode
git -C opencode fetch --force --tags origin

if [ -z "$tag" ]; then
  tag="$(git -C opencode tag --list 'v[0-9]*' --sort=-version:refname | head -n 1)"
fi

if [ -z "$tag" ]; then
  printf '%s\n' "Could not determine an upstream opencode release tag." >&2
  exit 1
fi

if ! git -C opencode rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  printf 'Unknown opencode tag: %s\n' "$tag" >&2
  exit 1
fi

current="$(git -C opencode describe --tags --always)"

if [ "$current" = "$tag" ]; then
  printf 'opencode already at %s\n' "$tag"
  exit 0
fi

git -C opencode checkout --detach "$tag"
printf 'Updated opencode submodule from %s to %s\n' "$current" "$tag"
git status --short opencode
