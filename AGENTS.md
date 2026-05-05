## Scope

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Root-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, and `tests/`.
- If you need upstream context, read the closest `AGENTS.md` inside `opencode/` first.

## Entry Points

- `Dockerfile` is the real integration path: it runs `bun run test:compat`, bundles `runtime/index.ts` with `bun run build:runtime`, builds `opencode/packages/app`, patches the built app with `bun run build:prepare-static`, then serves it with nginx.
- `runtime/generate-nginx-config.sh` is the runtime generation source of truth. It validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, requires contiguous unpadded indexes starting at `1`, normalizes hostnames and backend URLs, writes per-host runtime configs under `/opt/opencode-web/runtime-configs/<host>.js`, and regenerates `/etc/nginx/conf.d/default.conf` from `config/nginx.conf.template`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and `opencode-web-customizations.css` into `index.html`, then patches built JS so the app uses `window.__OPENCODE_SERVER_URL` instead of `location.origin`.
- `config/nginx.conf.template` is the base nginx cache/CSP contract: unmatched hosts return 404 except `/health`, configured hosts are appended by the generator, only `/assets/` is immutable, and all other configured-host responses stay `no-store` with `add_header ... always`.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because root `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every assumption this wrapper makes about upstream app internals and `config/nginx.conf.template`. If upstream changes break the wrapper, update the contract and the wrapper code together.
- `bun run test:compat` is the same upstream-compat guard used during `docker build`.
- CSP/cache headers are intentionally duplicated in `config/nginx.conf.template` and `runtime/generate-nginx-config.sh`; keep them in sync.

## Commands

- First-time setup: `git submodule update --init --recursive`
- Install root dependencies: `bun install --frozen-lockfile`
- Root verification after edits: `bun test && bun run typecheck && bun run lint && bun run format:check`
- Apply formatting: `bun run format`
- Upstream compatibility check only: `bun run test:compat`
- Runtime bundle only: `bun run build:runtime`
- Static web preparation only: `bun run build:prepare-static -- <dist-dir>`
- Focused root tests: `bun test tests/<name>.test.ts`, for example `bun test tests/compatibility-contracts.test.ts`
- Runtime/image regression check: `bun run test:runtime-config -- --build`; without `--build`, the script expects an existing `opencode-web-docker` image.
- End-to-end build: `docker build -t opencode-web-docker .`
- Quick upstream app build smoke check: `bun run --cwd opencode/packages/app build`
- Update upstream submodule: `bun run upstream:update -- [tag]`

## Gotchas

- CI workflow is `.github/workflows/ci.yml`; it also runs `actionlint` and `shellcheck` on repo-owned workflows and `*.sh` files outside `opencode/`.
- Root `typecheck`, `lint`, and `format` scripts cover `build/`, `runtime/`, `tests/`, and `scripts/`; edits in `config/` or `.github/workflows/` need separate review/tooling.
- Shell scripts are `/bin/sh`/Alpine-compatible; do not use Bash-only syntax in `runtime/generate-nginx-config.sh`.
- Bun is pinned by `package.json` `packageManager`, `Dockerfile`, and `@types/bun`; GitHub `setup-bun` steps intentionally omit `bun-version` because v2 reads `packageManager` by default.
- Upstream OpenCode’s default branch is `dev`, not `main`.
