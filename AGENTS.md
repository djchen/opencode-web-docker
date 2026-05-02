## Scope

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Root-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, and `tests/`.
- If you need upstream context, read the closest `AGENTS.md` inside `opencode/` first.

## Entry Points

- `Dockerfile` is the real integration path: it runs `build/check-runtime-config-compat.ts`, bundles `runtime/index.ts`, builds `opencode/packages/app`, patches the built app with `build/prepare-static-web.ts`, then serves it with `static-web-server`.
- `runtime/entrypoint.sh` is the runtime source of truth. It validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, requires contiguous unpadded indexes starting at `1`, normalizes hostnames and backend URLs, writes per-host roots under `/opt/opencode-web/vhosts/<host>/`, prepares an unmatched-host root without runtime config, and regenerates `/opt/opencode-web/config/sws.toml`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and `opencode-web-customizations.css` into `index.html`, then patches built JS so the app uses `window.__OPENCODE_SERVER_URL` instead of `location.origin`.
- `config/sws.toml` is the base SWS cache/CSP contract: the catch-all `/**` rule stays `no-store`, `/assets/**` stays long-lived and immutable, and `/assets/**` must remain after `/**` because SWS header rules are last-match-wins.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because root `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every assumption this wrapper makes about upstream app internals and `config/sws.toml`. If upstream changes break the wrapper, update the contract and the wrapper code together.
- `bun ./build/check-runtime-config-compat.ts` is the same upstream-compat guard used during `docker build`.

## Commands

- First-time setup: `git submodule update --init --recursive`
- Root verification after edits: `bun test && bun run typecheck && bun run lint && bun run format:check`
- Apply formatting: `bun run format`
- Upstream compatibility check only: `bun ./build/check-runtime-config-compat.ts`
- Runtime bundle only: `bun run build:runtime`
- Focused root tests: `bun test tests/runtime-config-core.test.ts`, `bun test tests/prepare-static-web.test.ts`, `bun test tests/static-csp.test.ts`
- Runtime/image regression check: `./scripts/test-runtime-config.sh --build`
- End-to-end build: `docker build -t opencode-web-docker .`
- Quick upstream app build smoke check: `bun run --cwd opencode/packages/app build`
- Update upstream submodule: `./scripts/update-opencode-release.sh [tag]` or `bun run upstream:update`

## Gotchas

- CI workflow is `.github/workflows/ci.yml`; it also runs `actionlint` and `shellcheck` on repo-owned workflows and `*.sh` files outside `opencode/`.
- Root `typecheck`, `lint`, and `format` scripts only cover `build/`, `runtime/`, and `tests/`; edits in `scripts/`, `config/`, or `.github/workflows/` need separate review/tooling.
- Bun is pinned to `1.3.13` in `package.json`, `Dockerfile`, `.github/workflows/ci.yml`, and `@types/bun`; keep them in sync.
- Upstream OpenCode’s default branch is `dev`, not `main`.
