import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"

const root = path.resolve(import.meta.dir, "..")
const runtimeConfigCore = await readFile(path.join(root, "runtime/runtime-config-core.js"), "utf8")

const encodeBase64 = (value) => Buffer.from(value, "utf8").toString("base64")

function runRuntimeConfig(input) {
  const storage = new Map(Object.entries(input.storage ?? {}))
  const setCalls = []
  const warnings = []
  const script = [
    ";(function () {",
    '  var defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"',
    '  var serverStoreKey = "opencode.global.dat:server"',
    `  var forceDefaultMode = ${JSON.stringify(input.forceDefaultMode ?? "force")}`,
    `  var configuredDefaultIndex = ${input.configuredDefaultIndex ?? 1}`,
    `  var appTitle = ${JSON.stringify(input.appTitle ?? "")}`,
    `  var configuredServers = ${JSON.stringify(input.configuredServers ?? [], null, 2).replace(/^/gm, "  ")}`,
    runtimeConfigCore,
  ].join("\n")

  const context = {
    Buffer,
    JSON,
    TextDecoder,
    Uint8Array,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    console: { warn: (...args) => warnings.push(args) },
    document: { title: input.documentTitle ?? "OpenCode" },
    location: { origin: input.locationOrigin ?? "http://frontend.example.com" },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        setCalls.push({ key, value })
        storage.set(key, value)
      },
      removeItem: (key) => storage.delete(key),
    },
    window: {},
  }

  vm.runInNewContext(script, context, { timeout: 1000 })

  return {
    setCalls,
    storage,
    warnings,
    document: context.document,
    window: context.window,
  }
}

describe("runtime-config core", () => {
  test("keeps configured servers first, preserves extra servers, and removes location.origin fallback", () => {
    const state = {
      list: [
        { type: "http", http: { url: "http://persisted.example.com", username: "old-user", password: "old-pass" }, displayName: "Persisted" },
        { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runRuntimeConfig({
      forceDefaultMode: "force",
      configuredDefaultIndex: 2,
      configuredServers: [
        {
          url: encodeBase64("http://persisted.example.com"),
          name: encodeBase64("Renamed"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
        {
          url: encodeBase64("https://api2.example.com/"),
          name: encodeBase64("Server 2"),
          username: encodeBase64("alice"),
          password: encodeBase64("secret"),
        },
      ],
      storage: {
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server"))
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(saved.list.map((item) => item.http?.url ?? item.url)).toEqual([
      "http://persisted.example.com",
      "https://api2.example.com",
      "http://custom.example.com",
    ])
    expect(saved.list[0].displayName).toBe("Renamed")
    expect(saved.list[0].http.username).toBe("old-user")
    expect(saved.list[0].http.password).toBe("old-pass")
    expect(saved.list[1].http.username).toBe("alice")
    expect(saved.list[1].http.password).toBe("secret")
    expect(result.setCalls.map((call) => call.key)).toEqual([
      "opencode.global.dat:server",
      "opencode.settings.dat:defaultServerUrl",
    ])
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://persisted.example.com")
    expect(result.storage.get("opencode.settings.dat:defaultServerUrl")).toBe("https://api2.example.com")
  })

  test("preserves a valid persisted default in preserve mode without rewriting it", () => {
    const result = runRuntimeConfig({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [
        {
          url: encodeBase64("http://api1.example.com"),
          name: encodeBase64("Server 1"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
        {
          url: encodeBase64("http://api2.example.com"),
          name: encodeBase64("Server 2"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
      ],
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://api2.example.com",
        "opencode.global.dat:server": JSON.stringify({ list: [], projects: {}, lastProject: {} }),
      },
    })

    expect(result.storage.get("opencode.settings.dat:defaultServerUrl")).toBe("http://api2.example.com")
    expect(result.setCalls.some((call) => call.key === "opencode.settings.dat:defaultServerUrl")).toBe(false)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
  })

  test("skips localStorage writes when the effective config is unchanged", () => {
    const state = {
      list: [
        { type: "http", http: { url: "http://api1.example.com" }, displayName: "Server 1" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runRuntimeConfig({
      forceDefaultMode: "force",
      configuredDefaultIndex: 1,
      configuredServers: [{
        url: encodeBase64("http://api1.example.com"),
        name: encodeBase64("Server 1"),
        username: encodeBase64(""),
        password: encodeBase64(""),
      }],
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://api1.example.com",
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    expect(result.setCalls).toHaveLength(0)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
  })

  test("removes the current origin fallback and rewrites an invalid preserved default", () => {
    const result = runRuntimeConfig({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [{
        url: encodeBase64("http://api1.example.com"),
        name: encodeBase64("Server 1"),
        username: encodeBase64(""),
        password: encodeBase64(""),
      }],
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://frontend.example.com",
        "opencode.global.dat:server": JSON.stringify({
          list: [
            { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
            { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
          ],
          projects: {},
          lastProject: {},
        }),
      },
    })

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server"))
    expect(saved.list.map((item) => item.http?.url ?? item.url)).toEqual([
      "http://api1.example.com",
      "http://custom.example.com",
    ])
    expect(result.storage.get("opencode.settings.dat:defaultServerUrl")).toBe("http://api1.example.com")
  })

  test("warns and recovers from an incompatible persisted store", () => {
    const result = runRuntimeConfig({
      configuredServers: [
        {
          url: encodeBase64("http://api1.example.com"),
          name: encodeBase64("Server 1"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
      ],
      storage: {
        "opencode.global.dat:server": JSON.stringify({ list: {}, projects: null, lastProject: "broken" }),
      },
    })

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server"))
    expect(saved.list).toHaveLength(1)
    expect(saved.projects).toEqual({})
    expect(saved.lastProject).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("sets document.title when appTitle is configured", () => {
    const result = runRuntimeConfig({
      configuredServers: [
        {
          url: encodeBase64("http://api1.example.com"),
          name: encodeBase64("Server 1"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
      ],
      storage: {
        "opencode.global.dat:server": JSON.stringify({ list: [], projects: {}, lastProject: {} }),
      },
      documentTitle: "OpenCode",
      appTitle: encodeBase64("My Hosted OpenCode"),
    })

    expect(result.document.title).toBe("My Hosted OpenCode")
  })
})
