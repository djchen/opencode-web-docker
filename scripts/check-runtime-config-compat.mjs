import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const read = (file) => readFile(path.join(root, file), "utf8")

const [entry, persist, server] = await Promise.all([
  read("opencode/packages/app/src/entry.tsx"),
  read("opencode/packages/app/src/utils/persist.ts"),
  read("opencode/packages/app/src/context/server.tsx"),
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
]

const failures = checks.filter((check) => !check.ok).map((check) => `- ${check.message}`)

if (failures.length) {
  throw new Error(
    [
      "OpenCode runtime-config compatibility check failed.",
      ...failures,
      "Review 40-runtime-config.sh before building a new image against this upstream revision.",
    ].join("\n"),
  )
}

console.log("OpenCode runtime-config compatibility check passed")
