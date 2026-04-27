import { describe, expect, test } from "bun:test"
import { initRuntimeConfig } from "../runtime/runtime-config-core"
import type { RuntimeConfigDeps } from "../runtime/types"

const encodeBase64 = (value: string): string => Buffer.from(value, "utf8").toString("base64")

type GlobalMocks = {
  configuredServers: Array<{ url: string; name: string; username: string; password: string }>
  forceDefaultMode: string
  configuredDefaultIndex: number
  appTitle: string
}

function setupGlobals(mocks: Partial<GlobalMocks>): GlobalMocks {
  const configuredServers = mocks.configuredServers ?? []
  const forceDefaultMode = mocks.forceDefaultMode ?? "force"
  const configuredDefaultIndex = mocks.configuredDefaultIndex ?? 1
  const appTitle = mocks.appTitle ?? ""

  ;(globalThis as Record<string, unknown>).configuredServers = configuredServers
  ;(globalThis as Record<string, unknown>).forceDefaultMode = forceDefaultMode
  ;(globalThis as Record<string, unknown>).configuredDefaultIndex = configuredDefaultIndex
  ;(globalThis as Record<string, unknown>).appTitle = appTitle
  ;(globalThis as Record<string, unknown>)._b64d = (input: string): string => {
    if (!input) return ""
    const raw = Buffer.from(input, "base64").toString("binary")
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  return { configuredServers, forceDefaultMode, configuredDefaultIndex, appTitle }
}

function teardownGlobals() {
  delete (globalThis as Record<string, unknown>).configuredServers
  delete (globalThis as Record<string, unknown>).forceDefaultMode
  delete (globalThis as Record<string, unknown>).configuredDefaultIndex
  delete (globalThis as Record<string, unknown>).appTitle
  delete (globalThis as Record<string, unknown>)._b64d
}

function runWithDeps(input: {
  storage?: Record<string, string>
  forceDefaultMode?: string
  configuredDefaultIndex?: number
  appTitle?: string
  locationOrigin?: string
  configuredServers?: Array<{ url: string; name: string; username: string; password: string }>
}) {
  const storage = new Map(Object.entries(input.storage ?? {}))
  const warnings: unknown[][] = []
  const mockWindow: Record<string, unknown> = {}
  const mockDocument = { title: "OpenCode" }

  const deps: RuntimeConfigDeps = {
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        setCalls.push({ key, value })
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      length: storage.size,
      clear: () => storage.clear(),
      key: (_index: number) => null,
    },
    document: mockDocument as unknown as Document,
    location: { origin: input.locationOrigin ?? "http://frontend.example.com" } as Location,
    window: mockWindow as unknown as Window & typeof globalThis,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
  }

  const setCalls: Array<{ key: string; value: string }> = []

  setupGlobals({
    configuredServers: input.configuredServers ?? [],
    forceDefaultMode: input.forceDefaultMode ?? "force",
    configuredDefaultIndex: input.configuredDefaultIndex ?? 1,
    appTitle: input.appTitle ?? "",
  })

  try {
    initRuntimeConfig(deps)
  } finally {
    teardownGlobals()
  }

  return {
    setCalls,
    storage,
    warnings,
    document: mockDocument,
    window: mockWindow,
  }
}

describe("runtime-config-core", () => {
  test("keeps configured servers first, preserves extra servers, and removes location.origin fallback", () => {
    const state = {
      list: [
        {
          type: "http",
          http: { url: "http://persisted.example.com", username: "old-user", password: "old-pass" },
          displayName: "Persisted",
        },
        { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runWithDeps({
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

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server")!)
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(saved.list.map((item: { http?: { url: string }; url?: string }) => item.http?.url ?? item.url)).toEqual([
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
    const result = runWithDeps({
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

    const result = runWithDeps({
      forceDefaultMode: "force",
      configuredDefaultIndex: 1,
      configuredServers: [
        {
          url: encodeBase64("http://api1.example.com"),
          name: encodeBase64("Server 1"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
      ],
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://api1.example.com",
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    expect(result.setCalls).toHaveLength(0)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
  })

  test("removes the current origin fallback and rewrites an invalid preserved default", () => {
    const result = runWithDeps({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [
        {
          url: encodeBase64("http://api1.example.com"),
          name: encodeBase64("Server 1"),
          username: encodeBase64(""),
          password: encodeBase64(""),
        },
      ],
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

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server")!)
    expect(saved.list.map((item: { http?: { url: string }; url?: string }) => item.http?.url ?? item.url)).toEqual([
      "http://api1.example.com",
      "http://custom.example.com",
    ])
    expect(result.storage.get("opencode.settings.dat:defaultServerUrl")).toBe("http://api1.example.com")
  })

  test("warns and recovers from an incompatible persisted store", () => {
    const result = runWithDeps({
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

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server")!)
    expect(saved.list).toHaveLength(1)
    expect(saved.projects).toEqual({})
    expect(saved.lastProject).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("sets document.title when appTitle is configured", () => {
    const result = runWithDeps({
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
      appTitle: encodeBase64("My Hosted OpenCode"),
    })

    expect(result.document.title).toBe("My Hosted OpenCode")
  })
})
