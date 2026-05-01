## Workspace

- This repo owns the static-web wrapper only. `opencode/` is an upstream git submodule; do not edit files under it here. The only allowed upstream change is moving the submodule pointer.
- Root-owned code lives in `build/`, `runtime/`, `config/`, `scripts/`, and `tests/`.
- If you need upstream context, read the closest `AGENTS.md` inside `opencode/` first.

## Entry Points

- `Dockerfile` is the real integration path: it runs `build/check-runtime-config-compat.ts`, bundles `runtime/index.ts`, builds `opencode/packages/app`, patches the built app with `build/prepare-static-web.ts`, then serves it with `static-web-server`.
- `runtime/entrypoint.sh` is the runtime source of truth. It validates `OPENCODE_SERVER_<N>_*`, requires contiguous unpadded indexes starting at `1`, normalizes URLs, writes `/public/runtime-config.js`, and seeds browser localStorage.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and `opencode-web-customizations.css` into `index.html`, then patches built JS so the app uses `window.__OPENCODE_SERVER_URL` instead of `location.origin`.
- `config/sws.toml` is part of the contract: `index.html` and `/runtime-config.js` must stay `no-store`, while `/assets/**` stays long-lived and immutable.

## Compatibility Contracts

- Root `bun test` runs only `./tests` because `bunfig.toml` sets `[test].root = "./tests"`.
- `tests/*.contracts.ts` encode every assumption this wrapper makes about upstream app internals. If upstream changes break the wrapper, update the contract and the wrapper code together.
- `bun ./build/check-runtime-config-compat.ts` is the same upstream-compat guard used during `docker build`.

## Commands

- First-time setup: `git submodule update --init --recursive`
- Root verification after edits: `bun test && bun run typecheck && bun run lint && bun run format:check`
- Apply formatting: `bun run format`
- Runtime bundle only: `bun run build:runtime`
- Focused root tests: `bun test tests/runtime-config-core.test.ts`, `bun test tests/prepare-static-web.test.ts`, `bun test tests/static-csp.test.ts`
- Runtime/image regression check: `./scripts/test-runtime-config.sh --build`
- End-to-end build: `docker build -t opencode-web-docker .`
- Quick upstream app build smoke check: `bun run --cwd opencode/packages/app build`
- Update upstream submodule: `./scripts/update-opencode-release.sh [tag]` or `bun run upstream:update`

## Gotchas

- CI workflow is `.github/workflows/ci.yml`; it also runs `actionlint` and `shellcheck` on repo-owned workflows and `*.sh` files.
- Root `lint` and `format` scripts only cover `build/`, `runtime/`, and `tests/`; edits in `scripts/`, `config/`, or `.github/workflows/` are not covered by those commands.
- `package.json` and `Dockerfile` both pin Bun `1.3.13`; keep them in sync.
- Upstream OpenCode’s default branch is `dev`, not `main`.
