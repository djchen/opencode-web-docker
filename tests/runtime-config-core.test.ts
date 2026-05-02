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

type ConfiguredServer = { url: string; name: string }

function configuredServer(input: { url: string; name?: string }) {
  return {
    url: encodeBase64(input.url),
    name: encodeBase64(input.name ?? ""),
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
  configuredServers: ConfiguredServer[]
  appTitle: string
}

function setupGlobals(mocks: Partial<GlobalMocks>): GlobalMocks {
  const configuredServers = mocks.configuredServers ?? []
  const appTitle = mocks.appTitle ?? ""

  ;(globalThis as Record<string, unknown>).configuredServers = configuredServers
  ;(globalThis as Record<string, unknown>).appTitle = appTitle
  ;(globalThis as Record<string, unknown>)._b64d = (input: string): string => {
    if (!input) return ""
    const raw = Buffer.from(input, "base64").toString("binary")
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  return { configuredServers, appTitle }
}

function teardownGlobals() {
  delete (globalThis as Record<string, unknown>).configuredServers
  delete (globalThis as Record<string, unknown>).appTitle
  delete (globalThis as Record<string, unknown>)._b64d
}

function runWithDeps(input: {
  storage?: Record<string, string>
  appTitle?: string
  locationOrigin?: string
  configuredServers?: ConfiguredServer[]
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
    location: { origin: input.locationOrigin ?? "http://frontend.opencode.example.com" } as Location,
    window: mockWindow as unknown as Window & typeof globalThis,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
  }

  setupGlobals({
    configuredServers: input.configuredServers ?? [],
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
  appTitle?: string
  locationOrigin?: string
  configuredServers?: ConfiguredServer[]
}) {
  const bundleSource = await loadBundledRuntimeSource()
  const storage = new Map(Object.entries(input.storage ?? {}))
  const setCalls: Array<{ key: string; value: string }> = []
  const warnings: unknown[][] = []
  const script = [
    "function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}",
    `var configuredServers = ${JSON.stringify(input.configuredServers ?? [])};`,
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
    location: { origin: input.locationOrigin ?? "http://frontend.opencode.example.com" },
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
  test("keeps the injected server first, preserves extra servers, and removes location.origin fallback", () => {
    const state = {
      list: [
        {
          type: "http",
          http: { url: "http://persisted.example.com", username: "old-user", password: "old-pass" },
          displayName: "Persisted",
        },
        { type: "http", http: { url: "http://frontend.opencode.example.com" }, displayName: "Frontend" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "http://persisted.example.com", name: "Renamed" })],
      storage: {
        [serverStoreKey]: JSON.stringify(state),
      },
    })

    const saved = savedServerState(result)
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(savedServerUrls(result)).toEqual(["http://persisted.example.com", "http://custom.example.com"])
    expect(saved.list[0].displayName).toBe("Renamed")
    expect(saved.list[0].http.username).toBe("old-user")
    expect(saved.list[0].http.password).toBe("old-pass")
    expect(result.setCalls.map((call) => call.key)).toEqual([serverStoreKey, defaultServerUrlKey])
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://persisted.example.com")
    expect(result.storage.get(defaultServerUrlKey)).toBe("http://persisted.example.com")
  })

  test("skips localStorage writes when the effective config is unchanged", () => {
    const state = {
      list: [
        { type: "http", http: { url: "https://api1.opencode.example.com" }, displayName: "Server 1" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "Server 1" })],
      storage: {
        [defaultServerUrlKey]: "https://api1.opencode.example.com",
        [serverStoreKey]: JSON.stringify(state),
      },
    })

    expect(result.setCalls).toHaveLength(0)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("https://api1.opencode.example.com")
  })

  test("removes the current origin fallback and forces the injected backend as default", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "Server 1" })],
      storage: {
        [defaultServerUrlKey]: "http://frontend.opencode.example.com",
        [serverStoreKey]: JSON.stringify({
          list: [
            { type: "http", http: { url: "http://frontend.opencode.example.com" }, displayName: "Frontend" },
            { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
          ],
          projects: {},
          lastProject: {},
        }),
      },
    })

    expect(savedServerUrls(result)).toEqual(["https://api1.opencode.example.com", "http://custom.example.com"])
    expect(result.storage.get(defaultServerUrlKey)).toBe("https://api1.opencode.example.com")
  })

  test("warns and recovers from an incompatible persisted store", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "Server 1" })],
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
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "Server 1" })],
      storage: {
        [serverStoreKey]: "not json",
      },
    })

    expect(savedServerUrls(result)).toEqual(["https://api1.opencode.example.com"])
    expect(savedServerState(result).projects).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("sets document.title when appTitle is configured", () => {
    const result = runWithDeps({
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "Server 1" })],
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
      configuredServers: [configuredServer({ url: "https://api1.opencode.example.com", name: "München" })],
      appTitle: encodeBase64("你好 OpenCode"),
      storage: {
        [serverStoreKey]: emptyServerStateRaw(),
      },
    })

    const saved = JSON.parse(result.storage.get(serverStoreKey)!)

    expect(result.document.title).toBe("你好 OpenCode")
    expect((result.window as { __OPENCODE_SERVER_URL?: string }).__OPENCODE_SERVER_URL).toBe(
      "https://api1.opencode.example.com",
    )
    expect(result.storage.get(defaultServerUrlKey)).toBe("https://api1.opencode.example.com")
    expect(saved.list.map((item: { http: { url: string } }) => item.http.url)).toEqual([
      "https://api1.opencode.example.com",
    ])
    expect(saved.list[0].displayName).toBe("München")
  })
})
