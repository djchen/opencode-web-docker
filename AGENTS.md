## Scope

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Wrapper-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, `tests/`, and root Docker/CI/package config.
- If you must inspect upstream code, read the closest `AGENTS.md` inside `opencode/` first; upstream's default branch is `dev`, not `main`.

## Runtime Wiring

- `Dockerfile` is the real integration path: it installs the filtered upstream app workspace, patches `opencode/packages/app/src/entry.tsx` with `build/patch-upstream-app-source.ts`, builds `opencode/packages/app`, copies wrapper sources, runs `build/check-runtime-config-compat.ts`, bundles `runtime/index.ts`, prepares `opencode/packages/app/dist`, then serves it with nginx.
- `runtime/generate-nginx-config.sh` is the runtime generation source of truth. It runs as `/docker-entrypoint.d/40-opencode-web.sh` under Alpine `/bin/sh`, requires contiguous unpadded indexes starting at `1`, normalizes hostnames/backend URLs, writes per-host configs under `/opt/opencode-web/runtime-configs/<host>.js`, and regenerates nginx config from `config/nginx.conf.template`.
- `runtime/runtime-config-core.ts` is the browser bootstrap: it replaces the persisted server list and default server URL with the injected backend for that host, prunes other servers/credentials, and removes legacy `server.v3`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and writes `opencode-web-customizations.css` from `build/customization-css.ts`; source-level URL injection belongs in `build/patch-upstream-app-source.ts` before the upstream app build.
- `config/nginx.conf.template` is the base nginx cache/CSP contract: unmatched hosts return 404 except `/health`, configured hosts are appended by the generator, only `/assets/` is immutable, and all other configured-host responses stay `no-store` with `add_header ... always`.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because root `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every wrapper assumption about upstream app internals, runtime persistence, CSS selectors, and nginx CSP/cache behavior. If upstream changes break the wrapper, update the contract and wrapper code together.
- `bun run test:compat` is the same upstream-compat guard used during `docker build`; keep it free of extra root-only dependencies because Docker invokes `bun ./build/check-runtime-config-compat.ts` without installing the root package.
- CSP/cache headers are intentionally duplicated in `config/nginx.conf.template` and `runtime/generate-nginx-config.sh`; keep them in sync.

## Commands

- First-time setup: `git submodule update --init --recursive`
- Install root dependencies: `bun install --frozen-lockfile`
- Root dependency install is wrapper-only; upstream app deps are installed separately by Docker or the Docker-equivalent upstream app build command below.
- Fast root checks matching CI's build-compat job: `bun test && bun run test:compat && bun run typecheck && bun run lint && bun run format:check`
- Apply formatting: `bun run format`
- Upstream compatibility check only: `bun run test:compat`
- Runtime bundle only: `bun run build:runtime`
- Static web preparation only, after the upstream app dist exists: `bun run build:prepare-static -- opencode/packages/app/dist`
- Focused root tests: `bun test tests/<name>.test.ts`, for example `bun test tests/compatibility-contracts.test.ts`
- Runtime/image regression check: `bun run test:runtime-config -- --build`; without `--build`, the script expects an existing image tag, defaulting to `opencode-web-docker`.
- End-to-end build: `bun run docker:build` or `docker build -t opencode-web-docker .`
- Docker-equivalent upstream app build: `bun install --cwd opencode --filter @opencode-ai/app --frozen-lockfile --ignore-scripts` then `bun ./build/patch-upstream-app-source.ts ./opencode/packages/app/src` then `OPENCODE_CHANNEL=prod bun run --cwd opencode/packages/app build -- --sourcemap false`
- That Docker-equivalent build patches `opencode/packages/app/src/entry.tsx` in-place; expect the submodule to be dirty afterward.
- Update upstream submodule: `bun run upstream:update -- [tag]`
- Dry-run upstream update: `bun run upstream:update -- --dry-run [tag]`

## Gotchas

- CI enters through `.github/workflows/ci.yml` and reusable `validate.yml`; it includes Docker runtime regression, `bun test`, `test:compat`, typecheck, Biome lint/format, `actionlint`, `zizmor`, and `shellcheck`.
- GitHub Actions are pinned by full SHA, and `zizmor` allowlists action names in `.github/zizmor.yml`; update both when editing workflows.
- Root `typecheck`, `lint`, and `format` scripts cover wrapper TS/JSON in `build/`, `runtime/`, `tests/`, and `scripts/`; nginx config, workflows, Docker files, and shell semantics need separate review/tooling.
- The Docker build context excludes `scripts/` and most upstream docs/tests via `.dockerignore`; update `.dockerignore` before relying on ignored files in `Dockerfile`.
- Shell scripts are `/bin/sh`/Alpine-compatible; keep `runtime/generate-nginx-config.sh` env scanning newline-safe so multiline values cannot create fake `SERVER_<N>_*` names.
- The final image runs as non-root `nginx` on port `8080`; keep `/opt/opencode-web/public` read-only and generated config/writable state under `/etc/nginx/conf.d`, `/opt/opencode-web/runtime-configs`, or `/var/cache/nginx`.
- Root TypeScript uses `erasableSyntaxOnly`; avoid enums, namespaces, parameter properties, or other TS syntax that needs transpilation in wrapper `.ts` files.
- Bun version sources are duplicated: `package.json` `packageManager` drives GitHub `setup-bun`, while `Dockerfile` and `@types/bun` must be reviewed separately when changing Bun.
