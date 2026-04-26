import { afterEach, describe, expect, test } from "bun:test"
import { initRuntimeConfig, extractUrl, defaultServerUrlKey, serverStoreKey } from "../runtime/runtime-config-core"
import type { RuntimeConfigDeps, ServerListItem, ServerState } from "../runtime/types"
import { MockStorage } from "./helpers/mock-storage"

function createMockDeps(input: {
  storage?: Record<string, string>
  locationOrigin?: string
  documentTitle?: string
}): {
  deps: RuntimeConfigDeps
  storage: MockStorage
  warnings: string[][]
  window: Record<string, unknown>
} {
  const storage = new MockStorage()
  if (input.storage) {
    for (const [k, v] of Object.entries(input.storage)) {
      storage.store.set(k, v)
    }
  }
  storage.setCalls.length = 0

  const warnings: string[][] = []
  const locationOrigin = input.locationOrigin ?? "http://frontend.example.com"

  const mockDocument = {
    title: input.documentTitle ?? "OpenCode",
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => {
      const el = {
        children: [] as HTMLElement[],
        attributes: {} as Record<string, string>,
        textContent: "",
        onclick: null as ((e: MouseEvent) => void) | null,
        id: "",
        style: { cssText: "" },
        setAttribute(key: string, value: string) { el.attributes[key] = value },
        appendChild(child: HTMLElement) { el.children.push(child) },
        contains: () => false,
        remove: () => {},
        querySelector: () => null as HTMLElement | null,
      }
      return el as unknown as HTMLElement
    },
  }

  const mockLocation = { href: `${locationOrigin}/`, origin: locationOrigin, reload: () => {} }

  const windowObj: Record<string, unknown> = {}

  const deps: RuntimeConfigDeps = {
    localStorage: storage as Storage,
    document: mockDocument as unknown as Document,
    location: mockLocation as unknown as Location,
    window: windowObj as unknown as (Window & typeof globalThis),
    console: { warn: (...args: unknown[]) => { warnings.push(args as string[]) }, log: () => {} },
  }

  return { deps, storage, warnings, window: windowObj }
}

// We need to set globals that runtime-config-core reads via `declare const`
// The initRuntimeConfig function reads from global scope (preamble vars)
// So we need to set them on globalThis before calling initRuntimeConfig
function setPreambleGlobals(globals: {
  serverUrl?: string
  serverName?: string
  serverUsername?: string
  serverPassword?: string
  appTitle?: string
  settingsSyncUrl?: string
  settingsSyncInterval?: string
  settingsSyncAuthHeader?: string
  settingsSyncUsername?: string
  settingsSyncPassword?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  g.serverUrl = globals.serverUrl ?? "http://api1.example.com"
  g.serverName = globals.serverName ?? ""
  g.serverUsername = globals.serverUsername ?? ""
  g.serverPassword = globals.serverPassword ?? ""
  g.appTitle = globals.appTitle ?? ""
  g.settingsSyncUrl = globals.settingsSyncUrl ?? ""
  g.settingsSyncInterval = globals.settingsSyncInterval ?? "30"
  g.settingsSyncAuthHeader = globals.settingsSyncAuthHeader ?? ""
  g.settingsSyncUsername = globals.settingsSyncUsername ?? ""
  g.settingsSyncPassword = globals.settingsSyncPassword ?? ""
}

function clearPreambleGlobals() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  delete g.serverUrl
  delete g.serverName
  delete g.serverUsername
  delete g.serverPassword
  delete g.appTitle
  delete g.settingsSyncUrl
  delete g.settingsSyncInterval
  delete g.settingsSyncAuthHeader
  delete g.settingsSyncUsername
  delete g.settingsSyncPassword
}

describe("runtime-config core", () => {
  test("sets document.title when appTitle is configured", () => {
    setPreambleGlobals({ serverUrl: "http://api1.example.com", appTitle: "My Hosted OpenCode" })
    const { deps, storage } = createMockDeps({ storage: {} })

    initRuntimeConfig(deps)

    expect(deps.document.title).toBe("My Hosted OpenCode")

    clearPreambleGlobals()
  })

  test("writes the configured server to localStorage and sets window.__OPENCODE_SERVER_URL", () => {
    setPreambleGlobals({ serverUrl: "http://api1.example.com", serverName: "My Server" })
    const { deps, storage, window } = createMockDeps({ storage: {} })

    initRuntimeConfig(deps)

    const saved = JSON.parse(storage.getItem("opencode.global.dat:server")!) as ServerState
    expect(saved.list).toHaveLength(1)
    expect(saved.list[0]!.type).toBe("http")
    expect(saved.list[0]!.http!.url).toBe("http://api1.example.com")
    expect(saved.list[0]!.displayName).toBe("My Server")
    expect(window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")

    clearPreambleGlobals()
  })

  test("sets defaultServerUrl to the configured server URL", () => {
    setPreambleGlobals({ serverUrl: "http://api1.example.com" })
    const { deps, storage } = createMockDeps({ storage: {} })

    initRuntimeConfig(deps)

    expect(storage.getItem("opencode.settings.dat:defaultServerUrl")).toBe("http://api1.example.com")

    clearPreambleGlobals()
  })

  test("prepends configured server and removes location.origin from existing list", () => {
    const state: ServerState = {
      list: [
        { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    setPreambleGlobals({ serverUrl: "http://api1.example.com" })
    const { deps, storage } = createMockDeps({
      storage: { "opencode.global.dat:server": JSON.stringify(state) },
      locationOrigin: "http://frontend.example.com",
    })

    initRuntimeConfig(deps)

    const saved = JSON.parse(storage.getItem("opencode.global.dat:server")!) as ServerState
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(saved.list.map((item: ServerListItem) => item.http!.url)).toEqual([
      "http://api1.example.com",
      "http://custom.example.com",
    ])

    clearPreambleGlobals()
  })

  test("skips localStorage writes when the effective config is unchanged", () => {
    const state: ServerState = {
      list: [
        { type: "http", http: { url: "http://api1.example.com" }, displayName: "Server 1" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    setPreambleGlobals({ serverUrl: "http://api1.example.com" })
    const { deps, storage, window } = createMockDeps({
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://api1.example.com",
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    initRuntimeConfig(deps)

    expect(storage.setCalls).toHaveLength(0)
    expect(window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")

    clearPreambleGlobals()
  })

  test("warns and recovers from an incompatible persisted store", () => {
    setPreambleGlobals({ serverUrl: "http://api1.example.com" })
    const { deps, storage, warnings } = createMockDeps({
      storage: {
        "opencode.global.dat:server": JSON.stringify({ list: {}, projects: null, lastProject: "broken" }),
      },
    })

    initRuntimeConfig(deps)

    const saved = JSON.parse(storage.getItem("opencode.global.dat:server")!) as ServerState
    expect(saved.list).toHaveLength(1)
    expect(saved.projects).toEqual({})
    expect(saved.lastProject).toEqual({})
    expect(warnings.length).toBeGreaterThan(0)

    clearPreambleGlobals()
  })

  test("extractUrl handles various input types", () => {
    expect(extractUrl("http://api1.example.com")).toBe("http://api1.example.com")
    expect(extractUrl("  http://api1.example.com  ")).toBe("http://api1.example.com")
    expect(extractUrl("http://api1.example.com/")).toBe("http://api1.example.com")
    expect(extractUrl("http://api1.example.com///")).toBe("http://api1.example.com")
    expect(extractUrl(42 as unknown as string)).toBe("")
    expect(extractUrl("")).toBe("")
  })

  test("skips runtime config when serverUrl is not set", () => {
    clearPreambleGlobals()
    const { deps, storage, warnings, window } = createMockDeps({ storage: {} })

    initRuntimeConfig(deps)

    expect(window.__OPENCODE_SERVER_URL).toBeUndefined()
    expect(storage.getItem("opencode.global.dat:server")).toBeNull()
    expect(warnings.length).toBeGreaterThan(0)

    clearPreambleGlobals()
  })
})