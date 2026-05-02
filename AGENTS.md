## Scope

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Root-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, and `tests/`.
- If you need upstream context, read the closest `AGENTS.md` inside `opencode/` first.

## Entry Points

- `Dockerfile` is the real integration path: it runs `build/check-runtime-config-compat.ts`, bundles `runtime/index.ts`, builds `opencode/packages/app`, patches the built app with `build/prepare-static-web.ts`, then serves it with nginx.
- `runtime/generate-nginx-config.sh` is the runtime generation source of truth. It validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, requires contiguous unpadded indexes starting at `1`, normalizes hostnames and backend URLs, writes per-host runtime configs under `/opt/opencode-web/runtime-configs/<host>.js`, and regenerates `/etc/nginx/conf.d/default.conf` from `config/nginx.conf.template`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and `opencode-web-customizations.css` into `index.html`, then patches built JS so the app uses `window.__OPENCODE_SERVER_URL` instead of `location.origin`.
- `config/nginx.conf.template` is the base nginx cache/CSP contract: unmatched hosts return 404 except `/health`, configured hosts are appended by the generator, only `/assets/` is immutable, and all other configured-host responses stay `no-store` with `add_header ... always`.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because root `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every assumption this wrapper makes about upstream app internals and `config/nginx.conf.template`. If upstream changes break the wrapper, update the contract and the wrapper code together.
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
