import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const read = (file) => readFile(path.join(root, file), "utf8")

const [entry, persist, server, sidebarShell, iconButton, tooltip] = await Promise.all([
  read("opencode/packages/app/src/entry.tsx"),
  read("opencode/packages/app/src/utils/persist.ts"),
  read("opencode/packages/app/src/context/server.tsx"),
  read("opencode/packages/app/src/pages/layout/sidebar-shell.tsx"),
  read("opencode/packages/ui/src/components/icon-button.tsx"),
  read("opencode/packages/ui/src/components/tooltip.tsx"),
])

const checks = [
  {
    ok: /const DEFAULT_SERVER_URL_KEY = "opencode\.settings\.dat:defaultServerUrl"/.test(entry),
    message: "expected app default server key to remain opencode.settings.dat:defaultServerUrl",
  },
  {
    ok: /const GLOBAL_STORAGE = "opencode\.global\.dat"/.test(persist),
    message: "expected global storage prefix to remain opencode.global.dat",
  },
  {
    ok: /Persist\.global\("server"(?:,|\))/.test(server),
    message: 'expected server persistence to keep using Persist.global("server")',
  },
  {
    ok: /export type Http = \{\s*type: "http"\s*http: HttpBase\s*\} & Base/s.test(server),
    message: 'expected ServerConnection.Http to keep the { type: "http", http: HttpBase } shape',
  },
  {
    ok: /export type HttpBase = \{\s*url: string/s.test(server),
    message: "expected ServerConnection.HttpBase to keep a string url field",
  },
  {
    ok: /(?:window\.)?location\.hostname\.includes\("opencode\.ai"\)/.test(entry),
    message:
      'expected app getCurrentUrl to keep the opencode.ai hostname check (used by prepare-static-web.mjs JS patch)',
  },
  {
    ok: /return (?:window\.)?location\.origin/.test(entry),
    message:
      "expected app getCurrentUrl to keep returning location.origin as fallback (used by prepare-static-web.mjs JS patch)",
  },
  {
    ok: /data-component="sidebar-rail"/.test(sidebarShell),
    message:
      'expected sidebar rail markup to keep data-component="sidebar-rail" (used by prepare-static-web.mjs help-button CSS)',
  },
  {
    ok: /icon="help"/.test(sidebarShell),
    message:
      'expected sidebar help action to keep rendering an IconButton with icon="help" (used by prepare-static-web.mjs help-button CSS)',
  },
  {
    ok: /data-component="icon-button"/.test(iconButton) && /data-icon=\{props\.icon\}/.test(iconButton),
    message:
      'expected IconButton to keep exposing data-component="icon-button" and data-icon={props.icon} (used by prepare-static-web.mjs help-button CSS)',
  },
  {
    ok: /data-component="tooltip-trigger"/.test(tooltip),
    message:
      'expected Tooltip trigger to keep data-component="tooltip-trigger" (used by prepare-static-web.mjs help-button CSS)',
  },
]

const failures = checks.filter((check) => !check.ok).map((check) => `- ${check.message}`)

if (failures.length) {
  throw new Error(
    [
      "OpenCode runtime-config compatibility check failed.",
      ...failures,
      "Review runtime-config.sh before building a new image against this upstream revision.",
    ].join("\n"),
  )
}

console.log("OpenCode runtime-config compatibility check passed")
