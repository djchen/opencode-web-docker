import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { buildRuntimeBundle } from "../build/transpile-runtime"
import { initRuntimeConfig } from "../runtime/runtime-config-core"
import type { RuntimeConfigDeps } from "../runtime/types"

const serverStoreKey = "opencode.global.dat:server"
const defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"

const encodeBase64 = (value: string): string => Buffer.from(value, "utf8").toString("base64")
const emptyServerState = () => ({ list: [], projects: {}, lastProject: {} })
const emptyServerStateRaw = () => JSON.stringify(emptyServerState())

function configuredServer(input: { url: string; name?: string; username?: string; password?: string }) {
  return {
    url: encodeBase64(input.url),
    name: encodeBase64(input.name ?? ""),
    username: encodeBase64(input.username ?? ""),
    password: encodeBase64(input.password ?? ""),
  }
}

function savedServerState(result: ReturnType<typeof runWithDeps>) {
  return JSON.parse(result.storage.get(serverStoreKey)!)
}

function savedServerUrls(result: ReturnType<typeof runWithDeps>): string[] {
  return savedServerState(result).list.map(
    (item: { http?: { url: string }; url?: string }) => item.http?.url ?? item.url,
  )
}

let bundleDir: string | undefined
let bundledRuntimeSourcePromise: Promise<string> | undefined

async function loadBundledRuntimeSource(): Promise<string> {
  bundledRuntimeSourcePromise ??= (async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "runtime-bundle-test-"))
    await buildRuntimeBundle(bundleDir)
    return readFile(path.join(bundleDir, "runtime-bundle.js"), "utf8")
  })()

  return bundledRuntimeSourcePromise
}

afterAll(async () => {
  if (!bundleDir) return
  await rm(bundleDir, { recursive: true, force: true })
})

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
  const setCalls: Array<{ key: string; value: string }> = []
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

async function runBundledRuntimeConfig(input: {
  storage?: Record<string, string>
  forceDefaultMode?: string
  configuredDefaultIndex?: number
  appTitle?: string
  locationOrigin?: string
  configuredServers?: Array<{ url: string; name: string; username: string; password: string }>
}) {
  const bundleSource = await loadBundledRuntimeSource()
  const storage = new Map(Object.entries(input.storage ?? {}))
  const setCalls: Array<{ key: string; value: string }> = []
  const warnings: unknown[][] = []
  const script = [
    "function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}",
    `var configuredServers = ${JSON.stringify(input.configuredServers ?? [])};`,
    `var forceDefaultMode = ${JSON.stringify(input.forceDefaultMode ?? "force")};`,
    `var configuredDefaultIndex = ${JSON.stringify(input.configuredDefaultIndex ?? 1)};`,
    `var appTitle = ${JSON.stringify(input.appTitle ?? "")};`,
    bundleSource,
  ].join("\n")

  const context = {
    Buffer,
    JSON,
    TextDecoder,
    Uint8Array,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    document: { title: "OpenCode" },
    location: { origin: input.locationOrigin ?? "http://frontend.example.com" },
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        setCalls.push({ key, value })
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
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
        configuredServer({ url: "http://persisted.example.com", name: "Renamed" }),
        configuredServer({
          url: "https://opencode-api2.example.com/",
          name: "Server 2",
          username: "alice",
          password: "secret",
        }),
      ],
      storage: {
        [serverStoreKey]: JSON.stringify(state),
      },
    })

    const saved = savedServerState(result)
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(savedServerUrls(result)).toEqual([
      "http://persisted.example.com",
      "https://opencode-api2.example.com",
      "http://custom.example.com",
    ])
    expect(saved.list[0].displayName).toBe("Renamed")
    expect(saved.list[0].http.username).toBe("old-user")
    expect(saved.list[0].http.password).toBe("old-pass")
    expect(saved.list[1].http.username).toBe("alice")
    expect(saved.list[1].http.password).toBe("secret")
    expect(result.setCalls.map((call) => call.key)).toEqual([serverStoreKey, defaultServerUrlKey])
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://persisted.example.com")
    expect(result.storage.get(defaultServerUrlKey)).toBe("https://opencode-api2.example.com")
  })

  test("preserves a valid persisted default in preserve mode without rewriting it", () => {
    const result = runWithDeps({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [
        configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" }),
        configuredServer({ url: "https://opencode-api2.example.com", name: "Server 2" }),
      ],
      storage: {
        [defaultServerUrlKey]: "https://opencode-api2.example.com",
        [serverStoreKey]: emptyServerStateRaw(),
      },
    })

    expect(result.storage.get(defaultServerUrlKey)).toBe("https://opencode-api2.example.com")
    expect(result.setCalls.some((call) => call.key === defaultServerUrlKey)).toBe(false)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("https://opencode-api1.example.com")
  })

  test("normalizes a preserved default URL so it still matches a configured server", () => {
    const result = runWithDeps({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [
        configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" }),
        configuredServer({ url: "https://opencode-api2.example.com", name: "Server 2" }),
      ],
      storage: {
        [defaultServerUrlKey]: "https://opencode-api2.example.com/",
        [serverStoreKey]: emptyServerStateRaw(),
      },
    })

    const savedUrls = savedServerUrls(result)
    const defaultServerUrl = result.storage.get(defaultServerUrlKey)

    expect(savedUrls).toEqual(["https://opencode-api1.example.com", "https://opencode-api2.example.com"])
    expect(defaultServerUrl).toBe("https://opencode-api2.example.com")
    expect(savedUrls).toContain(defaultServerUrl!)
  })

  test("skips localStorage writes when the effective config is unchanged", () => {
    const state = {
      list: [
        { type: "http", http: { url: "https://opencode-api1.example.com" }, displayName: "Server 1" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runWithDeps({
      forceDefaultMode: "force",
      configuredDefaultIndex: 1,
      configuredServers: [configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" })],
      storage: {
        [defaultServerUrlKey]: "https://opencode-api1.example.com",
        [serverStoreKey]: JSON.stringify(state),
      },
    })

    expect(result.setCalls).toHaveLength(0)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("https://opencode-api1.example.com")
  })

  test("removes the current origin fallback and rewrites an invalid preserved default", () => {
    const result = runWithDeps({
      forceDefaultMode: "preserve",
      configuredDefaultIndex: 1,
      configuredServers: [configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" })],
      storage: {
        [defaultServerUrlKey]: "http://frontend.example.com",
        [serverStoreKey]: JSON.stringify({
          list: [
            { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
            { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
          ],
          projects: {},
          lastProject: {},
        }),
      },
    })

    expect(savedServerUrls(result)).toEqual(["https://opencode-api1.example.com", "http://custom.example.com"])
    expect(result.storage.get(defaultServerUrlKey)).toBe("https://opencode-api1.example.com")
  })

  test("warns and recovers from an incompatible persisted store", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" })],
      storage: {
        [serverStoreKey]: JSON.stringify({ list: {}, projects: null, lastProject: "broken" }),
      },
    })

    const saved = savedServerState(result)
    expect(saved.list).toHaveLength(1)
    expect(saved.projects).toEqual({})
    expect(saved.lastProject).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("warns and recovers from malformed persisted JSON", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" })],
      storage: {
        [serverStoreKey]: "not json",
      },
    })

    expect(savedServerUrls(result)).toEqual(["https://opencode-api1.example.com"])
    expect(savedServerState(result).projects).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("sets document.title when appTitle is configured", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://opencode-api1.example.com", name: "Server 1" })],
      storage: {
        [serverStoreKey]: emptyServerStateRaw(),
      },
      appTitle: encodeBase64("My Hosted OpenCode"),
    })

    expect(result.document.title).toBe("My Hosted OpenCode")
  })

  for (const testCase of [
    {
      name: "normalizes uppercase scheme and hostname to lowercase",
      inputUrl: "HTTPS://OPENCODE-API1.EXAMPLE.COM",
      expectedUrl: "https://opencode-api1.example.com",
    },
    {
      name: "lowercases scheme and host but preserves path case",
      inputUrl: "HTTPS://OPENCODE-API.EXAMPLE.COM/pAtH",
      expectedUrl: "https://opencode-api.example.com/pAtH",
    },
    {
      name: "preserves port while normalizing scheme and host",
      inputUrl: "HTTPS://OPENCODE-API.EXAMPLE.COM:8080",
      expectedUrl: "https://opencode-api.example.com:8080",
    },
  ]) {
    test(testCase.name, () => {
      const result = runWithDeps({
        configuredServers: [configuredServer({ url: testCase.inputUrl })],
        storage: {
          [serverStoreKey]: emptyServerStateRaw(),
        },
      })

      expect(savedServerUrls(result)).toEqual([testCase.expectedUrl])
      expect(result.window.__OPENCODE_SERVER_URL).toBe(testCase.expectedUrl)
    })
  }

  test("bundled runtime artifact executes correctly with unicode metadata", async () => {
    const result = await runBundledRuntimeConfig({
      forceDefaultMode: "force",
      configuredDefaultIndex: 2,
      configuredServers: [
        configuredServer({
          url: "https://opencode-api1.example.com",
          name: "München",
          username: "álîcè",
          password: "pässwörd",
        }),
        configuredServer({ url: "https://opencode-api2.example.com/", name: "東京" }),
      ],
      appTitle: encodeBase64("你好 OpenCode"),
      storage: {
        [serverStoreKey]: emptyServerStateRaw(),
      },
    })

    const saved = JSON.parse(result.storage.get(serverStoreKey)!)

    expect(result.document.title).toBe("你好 OpenCode")
    expect((result.window as { __OPENCODE_SERVER_URL?: string }).__OPENCODE_SERVER_URL).toBe(
      "https://opencode-api1.example.com",
    )
    expect(result.storage.get(defaultServerUrlKey)).toBe("https://opencode-api2.example.com")
    expect(saved.list.map((item: { http: { url: string } }) => item.http.url)).toEqual([
      "https://opencode-api1.example.com",
      "https://opencode-api2.example.com",
    ])
    expect(saved.list[0].displayName).toBe("München")
    expect(saved.list[0].http.username).toBe("álîcè")
    expect(saved.list[0].http.password).toBe("pässwörd")
    expect(saved.list[1].displayName).toBe("東京")
  })
})
