**Workspace**

- Repo root packages a self-hosted static web deployment around upstream OpenCode.
- `opencode/` is a git submodule pointing at `https://github.com/anomalyco/opencode.git`.
- Do not modify files under `opencode/`. Treat upstream code as read-only; the only upstream change allowed here is updating the submodule pointer.
- Root changes belong in the repo root, `build/`, `runtime/`, `config/`, or `scripts/`.
- When inspecting upstream code for context, read the closest `AGENTS.md` inside `opencode/` (`opencode/AGENTS.md`, `opencode/packages/app/AGENTS.md`, etc.).
- Runtime code is written in TypeScript (`runtime/*.ts`), bundled via `Bun.build()` into a single IIFE (`dist/runtime/runtime-bundle.js`) by `build/transpile-runtime.ts`.

**Commands**

- First-time setup: `git submodule update --init --recursive`
- Build the Docker image: `docker build -t opencode-web-docker .` (or `bun run docker:build`)
- Published image: `ghcr.io/djchen/opencode-web-docker` (multi-platform: `linux/amd64`, `linux/arm64`)
- Quick upstream app build check: `bun run --cwd opencode/packages/app build`
- Build runtime bundle: `bun run build:runtime`
- TypeScript typecheck: `bun run typecheck`
- Bump upstream submodule to a release tag: `./scripts/update-opencode-release.sh [tag]` (or `bun run upstream:update` for latest)

**Root CI**

- `ci-lint.yml` handles PR validation: it builds the Docker image and runs `./scripts/test-runtime-config.sh` on pull requests, runs `bun test tests`, runs `bun run typecheck`, runs `actionlint`, and runs `shellcheck` (severity warning) on repo-owned `*.sh` files (excludes `opencode/`).
- `docker-publish.yml` runs on `main` pushes, `v*` tags, and manual dispatch; it publishes multi-platform images to GHCR.
- `update-opencode-release.yml` runs daily (or on dispatch) to detect the latest upstream release, update the submodule, and open a PR.

**Static Web Flow**

- `Dockerfile` builds upstream `opencode/packages/app` and serves the assets with `static-web-server`.
- **Build-time**: `build/check-runtime-config-compat.ts` validates that the localStorage keys and shape used by `runtime/entrypoint.sh` still match upstream source (`entry.tsx`, `persist.ts`, `server.tsx`). This check runs in the Docker build; if it fails, the upstream app has changed its persistence API and `runtime/entrypoint.sh`, `runtime/runtime-config-core.ts`, or `runtime/sync-client.ts` must be updated before rebuilding.
- **Build-time**: `build/prepare-static-web.ts` injects `<script src="/runtime-config.js"></script>` into `index.html` before the module bundle so runtime config seeds localStorage before the app reads it. It patches only the JS assets referenced by `index.html` so `getCurrentUrl()` falls back to `window.__OPENCODE_SERVER_URL` instead of `location.origin`, removing the default localhost server and ensuring only the runtime-configured server appears.
- **Build-time**: `build/transpile-runtime.ts` bundles `runtime/index.ts` (which imports `runtime-config-core.ts`, `blob-sync.ts`, `sync-client.ts`) into a single IIFE file `dist/runtime/runtime-bundle.js` via `Bun.build()`. The Dockerfile runs `bun run build:runtime` and copies the bundle into the release image.
- **Runtime**: `runtime/entrypoint.sh` generates `/runtime-config.js` by concatenating a JS preamble (with env var assignments via base64-encoded `_b64d()` calls) and the pre-built `runtime-bundle.js`. All string env vars are base64-encoded by the entrypoint and decoded at runtime by the `_b64d` helper (`decodeURIComponent(escape(atob(s)))`), making the preamble safe for any byte sequence. `settingsSyncInterval` is injected as a plain numeric string since it never needs escaping. `OPENCODE_SERVER_URL` is required. Optional env vars: `OPENCODE_SERVER_NAME`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_APP_TITLE`, `OPENCODE_SETTINGS_SYNC_URL`, `OPENCODE_SETTINGS_SYNC_INTERVAL`, `OPENCODE_SETTINGS_SYNC_AUTH_HEADER`, `OPENCODE_SETTINGS_SYNC_USERNAME`, `OPENCODE_SETTINGS_SYNC_PASSWORD`. The generated script is synchronous (no `await`) and runs as a blocking `<script>` before the app bundle.
- **Runtime config core** (`runtime/runtime-config-core.ts`): Sets `document.title` from `appTitle`. Builds a single server object from env vars and merges it into the persisted server list. Removes `location.origin` from the list if it is not the configured server. Skips redundant writes. Sets `window.__OPENCODE_SERVER_URL`. If `settingsSyncUrl` is set, calls `initSettingsSync()`.
- **Blob sync** (`runtime/blob-sync.ts`): Provides `createBlobSync()` which manages periodic pull/push of a JSON blob to an external HTTPS endpoint. Accepts a `BlobSyncConfig` with optional timer/calendar dependencies for testability.
- **Sync client** (`runtime/sync-client.ts`): When `settingsSyncUrl` is set, pulls and pushes an allowlist of localStorage keys to an external HTTPS endpoint. Uses `localStorage.setItem`/`removeItem` interceptors to detect changes and schedule debounced pushes (3s) via `_markDirty()` (sets dirty flag + increments version + ensures push timer). Uses `_isSyncPulling` flag to prevent push-pull loops. After a successful push with new mutations during flight, `_ensurePushTimer()` reschedules without bumping the version again. Supports custom Authorization header or HTTP Basic Auth. Injects a sync button into the sidebar rail via `MutationObserver`. Displays "Last checked" timestamp (updated on any successful endpoint contact including 404). Uses module-level `_globalSyncInitialized` flag to ensure idempotent initialization.
- `config/sws.toml` sets no-cache headers on `/runtime-config.js` and `/index.html`.
- A separate `opencode serve` instance must handle the API and must allow the app origin with `--cors`.
- **Security**: `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` values are written into browser localStorage. Do not set them for public deployments; let users enter credentials in the app. Sync auth env vars (`OPENCODE_SETTINGS_SYNC_AUTH_HEADER`, `OPENCODE_SETTINGS_SYNC_USERNAME`, `OPENCODE_SETTINGS_SYNC_PASSWORD`) are embedded in browser-delivered JavaScript. Do not set `OPENCODE_SETTINGS_SYNC_AUTH_HEADER` to a shared secret or service token. 

**Upstream OpenCode**

- The upstream default branch and CI base branch are `dev`, not `main`.
- Bun version is pinned to `1.3.12` in both `package.json` and the Dockerfile.
- Primary root verification is `docker build -t opencode-web-docker .`; repo-owned focused checks also include `bun test tests`, `bun run typecheck`, and `./scripts/test-runtime-config.sh`.
- Upstream typecheck: `cd opencode && bun typecheck`
- Do not run `cd opencode && bun test`; it intentionally exits with "do not run tests from root". Use focused tests from package dirs (`cd opencode/packages/opencode && bun test`, `cd opencode/packages/app && bun test:unit`, etc.).
- For local browser UI work, run the backend from `opencode/packages/opencode` with `bun run --conditions=browser ./src/index.ts serve --port 4096`, run the app from `opencode/packages/app` with `bun dev -- --port 4444`, and use `http://localhost:4444`.

**Local Docker Cleanup**

- Local development and image verification leaves Docker artifacts. Clean up:
- Remove the project image: `docker rmi opencode-web-docker`
- Remove dangling images, stopped containers, and build cache: `docker system prune`
- Remove build cache: `docker builder prune`