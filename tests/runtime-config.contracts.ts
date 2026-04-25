import { every, match } from "./core"
import type { Check, Contract } from "./core"

export const entrySourcePath = "opencode/packages/app/src/entry.tsx"

export const runtimeConfigSources: Record<string, string> = {
  entry: entrySourcePath,
  persist: "opencode/packages/app/src/utils/persist.ts",
  server: "opencode/packages/app/src/context/server.tsx",
}

export const runtimeConfigContracts: Contract[] = [
  {
    area: "runtime-config persistence",
    hint: "If a localStorage key name or type shape changed, update runtime/runtime-config-core.ts; if only the internal variable was renamed, update the contract regex.",
    checks: [
      match(
        "entry",
        /const DEFAULT_SERVER_URL_KEY = "opencode\.settings\.dat:defaultServerUrl"/,
        "expected app default server key to remain opencode.settings.dat:defaultServerUrl",
      ),
      match(
        "persist",
        /const GLOBAL_STORAGE = "opencode\.global\.dat"/,
        "expected global storage prefix to remain opencode.global.dat",
      ),
      match(
        "server",
        /Persist\.global\("server"(?:,|\))/,
        'expected server persistence to keep using Persist.global("server")',
      ),
      every(
        "server",
        [/export type Http = \{/s, /type: "http"/, /http: HttpBase/, /\} & Base/s],
        'expected ServerConnection.Http to keep the { type: "http", http: HttpBase } shape',
      ),
      every(
        "server",
        [/export type HttpBase = \{/s, /url: string/],
        "expected ServerConnection.HttpBase to keep a string url field",
      ),
    ],
  },
]