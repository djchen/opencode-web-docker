## Scope

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Wrapper-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, `tests/`, and root Docker/CI/package config.
- If you need upstream context, read the closest `AGENTS.md` inside `opencode/` first.

## Entry Points

- `Dockerfile` is the real integration path: it runs `bun run test:compat`, bundles `runtime/index.ts` with `bun run build:runtime`, builds `opencode/packages/app`, patches the built app with `bun run build:prepare-static`, then serves it with nginx.
- `runtime/generate-nginx-config.sh` is the runtime generation source of truth. It validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, requires contiguous unpadded indexes starting at `1`, normalizes hostnames and backend URLs, writes per-host runtime configs under `/opt/opencode-web/runtime-configs/<host>.js`, and regenerates `/etc/nginx/conf.d/default.conf` from `config/nginx.conf.template`.
- `runtime/runtime-config-core.ts` is the browser bootstrap: it replaces the persisted server list and default server URL with the injected backend for that host, prunes other servers/credentials, and removes legacy `server.v3`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and external `opencode-web-customizations.css` into `index.html`, then patches referenced built JS so the app uses `window.__OPENCODE_SERVER_URL` instead of `location.origin`.
- `config/nginx.conf.template` is the base nginx cache/CSP contract: unmatched hosts return 404 except `/health`, configured hosts are appended by the generator, only `/assets/` is immutable, and all other configured-host responses stay `no-store` with `add_header ... always`.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because root `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every wrapper assumption about upstream app internals, runtime persistence, CSS selectors, and nginx CSP/cache behavior. If upstream changes break the wrapper, update the contract and wrapper code together.
- `bun run test:compat` is the same upstream-compat guard used during `docker build`.
- CSP/cache headers are intentionally duplicated in `config/nginx.conf.template` and `runtime/generate-nginx-config.sh`; keep them in sync.

## Commands

- First-time setup: `git submodule update --init --recursive`
- Install root dependencies: `bun install --frozen-lockfile`
- Fast root checks matching CI's build-compat job: `bun test && bun run test:compat && bun run typecheck && bun run lint && bun run format:check`
- Apply formatting: `bun run format`
- Upstream compatibility check only: `bun run test:compat`
- Runtime bundle only: `bun run build:runtime`
- Static web preparation only: `bun run build:prepare-static -- <dist-dir>`
- Focused root tests: `bun test tests/<name>.test.ts`, for example `bun test tests/compatibility-contracts.test.ts`
- Runtime/image regression check: `bun run test:runtime-config -- --build`; without `--build`, the script expects an existing image tag, defaulting to `opencode-web-docker`.
- End-to-end build: `docker build -t opencode-web-docker .`
- Quick upstream app build smoke check: `bun run --cwd opencode/packages/app build`
- Update upstream submodule: `bun run upstream:update -- [tag]`
- Dry-run upstream update: `bun run upstream:update -- --dry-run [tag]`

## Gotchas

- CI enters through `.github/workflows/ci.yml` and reusable `validate.yml`; it includes Docker runtime regression, `bun test`, `test:compat`, typecheck, Biome lint/format, `actionlint`, `zizmor`, and `shellcheck`.
- Root `typecheck`, `lint`, and `format` scripts cover `build/`, `runtime/`, `tests/`, and `scripts/`; edits in `config/` or `.github/workflows/` need separate review/tooling.
- The Docker build context excludes `scripts/` and most upstream docs/tests via `.dockerignore`; update `.dockerignore` before relying on ignored files in `Dockerfile`.
- Shell scripts are `/bin/sh`/Alpine-compatible; do not use Bash-only syntax in `runtime/generate-nginx-config.sh`.
- Bun version sources are duplicated: `package.json` `packageManager` drives GitHub `setup-bun`, while `Dockerfile` and `@types/bun` must be reviewed separately when changing Bun.
- Upstream OpenCode's default branch is `dev`, not `main`.
