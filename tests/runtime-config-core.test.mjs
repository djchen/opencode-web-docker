import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"

const root = path.resolve(import.meta.dir, "..")
const runtimeConfigCore = await readFile(path.join(root, "runtime/runtime-config-core.js"), "utf8")
const syncClient = await readFile(path.join(root, "runtime/sync-client.js"), "utf8")

function createStorageView(storage, setCalls, removeCalls) {
  const view = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      setCalls.push({ key, value })
      storage.set(key, value)
    },
    removeItem: (key) => {
      removeCalls.push(key)
      storage.delete(key)
    },
    key: (index) => Array.from(storage.keys())[index] ?? null,
    clear: () => storage.clear(),
  }

  Object.defineProperty(view, "length", {
    configurable: true,
    get() {
      return storage.size
    },
  })

  return view
}

function createMockDocument(input) {
  return {
    title: input.documentTitle ?? "OpenCode",
    readyState: "complete",
    addEventListener: () => {},
    hidden: false,
  }
}

function runRuntimeConfig(input) {
  const storage = new Map(Object.entries(input.storage ?? {}))
  const setCalls = []
  const removeCalls = []
  const warnings = []
  const fetchCalls = []
  const timers = []
  const intervals = []
  const eventListeners = {}

  const fetchImpl = input.fetchImpl ?? ((...args) => {
    fetchCalls.push(args)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })

  const script = [
    `var serverUrl = ${JSON.stringify(input.serverUrl ?? "http://api1.example.com")}`,
    `var serverName = ${JSON.stringify(input.serverName ?? "")}`,
    `var serverUsername = ${JSON.stringify(input.serverUsername ?? "")}`,
    `var serverPassword = ${JSON.stringify(input.serverPassword ?? "")}`,
    `var appTitle = ${JSON.stringify(input.appTitle ?? "")}`,
    `var settingsSyncUrl = ${JSON.stringify(input.settingsSyncUrl ?? "")}`,
    `var settingsSyncInterval = ${JSON.stringify(input.settingsSyncInterval ?? "30")}`,
    `var settingsSyncAuthHeader = ${JSON.stringify(input.settingsSyncAuthHeader ?? "")}`,
    `var settingsSyncUsername = ${JSON.stringify(input.settingsSyncUsername ?? "")}`,
    `var settingsSyncPassword = ${JSON.stringify(input.settingsSyncPassword ?? "")}`,
    runtimeConfigCore,
    syncClient,
  ].join("\n")

  const document = createMockDocument(input)

  const context = {
    Buffer,
    JSON,
    Math,
    Promise,
    TextDecoder,
    Uint8Array,
    URL,
    encodeURIComponent,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    console: { warn: (...args) => warnings.push(args) },
    document,
    location: {
      href: input.locationHref ?? `${input.locationOrigin ?? "http://frontend.example.com"}/`,
      origin: input.locationOrigin ?? "http://frontend.example.com",
    },
    localStorage: createStorageView(storage, setCalls, removeCalls),
    fetch: fetchImpl,
    setTimeout: (fn, ms) => {
      const id = timers.length + 1
      timers.push({ fn, ms })
      return id
    },
    clearTimeout: (id) => {
      if (id > 0 && id <= timers.length) timers[id - 1] = null
    },
    setInterval: (fn, ms) => {
      const id = intervals.length + 1
      intervals.push({ fn, ms })
      return id
    },
    clearInterval: () => {},
    window: {
      __OPENCODE_SYNC_STATUS: null,
    },
    MutationObserver: function () {
      this.observe = () => {}
      this.disconnect = () => {}
    },
  }

  context.window = Object.assign(context.window, {
    document,
    location: context.location,
    localStorage: context.localStorage,
    fetch: context.fetch,
    setTimeout: context.setTimeout,
    clearTimeout: context.clearTimeout,
    setInterval: context.setInterval,
    clearInterval: context.clearInterval,
    MutationObserver: context.MutationObserver,
    __OPENCODE_SYNC_STATUS: null,
  })

  vm.runInNewContext(script, context, { timeout: 5000 })

  return {
    context,
    fetchCalls,
    intervals,
    removeCalls,
    setCalls,
    storage,
    timers,
    warnings,
    document: context.document,
    window: context.window,
  }
}

describe("runtime-config core", () => {
  test("sets document.title when appTitle is configured", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      appTitle: "My Hosted OpenCode",
      documentTitle: "OpenCode",
      storage: {},
    })

    expect(result.document.title).toBe("My Hosted OpenCode")
  })

  test("writes the configured server to localStorage and sets window.__OPENCODE_SERVER_URL", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      serverName: "My Server",
      storage: {},
    })

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server"))
    expect(saved.list).toHaveLength(1)
    expect(saved.list[0].type).toBe("http")
    expect(saved.list[0].http.url).toBe("http://api1.example.com")
    expect(saved.list[0].displayName).toBe("My Server")
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
  })

  test("sets defaultServerUrl to the configured server URL", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      storage: {},
    })

    expect(result.storage.get("opencode.settings.dat:defaultServerUrl")).toBe("http://api1.example.com")
  })

  test("prepends configured server and removes location.origin from existing list", () => {
    const state = {
      list: [
        { type: "http", http: { url: "http://frontend.example.com" }, displayName: "Frontend" },
        { type: "http", http: { url: "http://custom.example.com" }, displayName: "Custom" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      storage: {
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    const saved = JSON.parse(result.storage.get("opencode.global.dat:server"))
    expect(saved.projects).toEqual(state.projects)
    expect(saved.lastProject).toEqual(state.lastProject)
    expect(saved.list.map((item) => item.http.url)).toEqual([
      "http://api1.example.com",
      "http://custom.example.com",
    ])
  })

  test("skips localStorage writes when the effective config is unchanged", () => {
    const state = {
      list: [
        { type: "http", http: { url: "http://api1.example.com" }, displayName: "Server 1" },
      ],
      projects: { keep: true },
      lastProject: { keep: true },
    }

    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      storage: {
        "opencode.settings.dat:defaultServerUrl": "http://api1.example.com",
        "opencode.global.dat:server": JSON.stringify(state),
      },
    })

    expect(result.setCalls).toHaveLength(0)
    expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
  })

  test("warns and recovers from an incompatible persisted store", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
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

  test("initSettingsSync is called when settingsSyncUrl is set", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      settingsSyncUrl: "https://sync.example.com/settings",
      settingsSyncInterval: "10",
      settingsSyncAuthHeader: "Bearer test-token",
      storage: {},
    })

    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(1)
    expect(result.fetchCalls[0][0]).toBe("https://sync.example.com/settings")
    expect(result.intervals.length).toBeGreaterThan(0)
  })

  test("initSettingsSync is not called when settingsSyncUrl is empty", () => {
    const result = runRuntimeConfig({
      serverUrl: "http://api1.example.com",
      settingsSyncUrl: "",
      storage: {},
    })

    expect(result.fetchCalls).toHaveLength(0)
  })

  describe("_b64d preamble decode", () => {
    const b64dFn = "function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}"

    function b64enc(value) {
      return Buffer.from(value, "utf8").toString("base64")
    }

    function runWithB64Preamble(input) {
      const lines = [
        b64dFn,
        `var serverUrl = _b64d(${JSON.stringify(b64enc(input.serverUrl ?? "http://api1.example.com"))})`,
        `var serverName = _b64d(${JSON.stringify(b64enc(input.serverName ?? ""))})`,
        `var serverUsername = _b64d(${JSON.stringify(b64enc(input.serverUsername ?? ""))})`,
        `var serverPassword = _b64d(${JSON.stringify(b64enc(input.serverPassword ?? ""))})`,
        `var appTitle = _b64d(${JSON.stringify(b64enc(input.appTitle ?? ""))})`,
        `var settingsSyncUrl = _b64d(${JSON.stringify(b64enc(input.settingsSyncUrl ?? ""))})`,
        `var settingsSyncInterval = ${JSON.stringify(input.settingsSyncInterval ?? "30")}`,
        `var settingsSyncAuthHeader = _b64d(${JSON.stringify(b64enc(input.settingsSyncAuthHeader ?? ""))})`,
        `var settingsSyncUsername = _b64d(${JSON.stringify(b64enc(input.settingsSyncUsername ?? ""))})`,
        `var settingsSyncPassword = _b64d(${JSON.stringify(b64enc(input.settingsSyncPassword ?? ""))})`,
        runtimeConfigCore,
        syncClient,
      ].join("\n")

      const storage = new Map(Object.entries(input.storage ?? {}))
      const setCalls = []
      const removeCalls = []
      const warnings = []

      const document = createMockDocument(input)

      const context = {
        Buffer,
        JSON,
        Math,
        Object,
        Array,
        Promise,
        TextDecoder,
        Uint8Array,
        TextEncoder,
        URL,
        encodeURIComponent,
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        btoa: (value) => Buffer.from(value, "binary").toString("base64"),
        unescape: unescape,
        console: { warn: (...args) => warnings.push(args) },
        document,
        location: {
          href: input.locationHref ?? `${input.locationOrigin ?? "http://frontend.example.com"}/`,
          origin: input.locationOrigin ?? "http://frontend.example.com",
        },
        localStorage: createStorageView(storage, setCalls, removeCalls),
        fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
      }

      context.window = Object.assign({}, context, { __OPENCODE_SYNC_STATUS: null })

      vm.runInNewContext(lines, context, { timeout: 5000 })

      return { context, storage, setCalls, warnings, document: context.document, window: context.window }
    }

    test("decodes ASCII server URL via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://api1.example.com",
        storage: {},
      })

      expect(result.context.serverUrl).toBe("http://api1.example.com")
      expect(result.window.__OPENCODE_SERVER_URL).toBe("http://api1.example.com")
    })

    test("decodes server name with spaces via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://api1.example.com",
        serverName: "Server 1",
        storage: {},
      })

      expect(result.context.serverName).toBe("Server 1")
    })

    test("decodes URL with special characters via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://user:p@ss%20word@host.example.com/path?q=1&a=2#frag",
        storage: {},
      })

      expect(result.context.serverUrl).toBe("http://user:p@ss%20word@host.example.com/path?q=1&a=2#frag")
    })

    test("decodes empty string via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://api1.example.com",
        serverName: "",
        storage: {},
      })

      expect(result.context.serverName).toBe("")
    })

    test("decodes UTF-8 server name via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://api1.example.com",
        serverName: "Server \u00e9\u00e0\u00fc",
        storage: {},
      })

      expect(result.context.serverName).toBe("Server \u00e9\u00e0\u00fc")
    })

    test("decodes string with quotes and backslashes via _b64d", () => {
      const result = runWithB64Preamble({
        serverUrl: "http://api1.example.com",
        serverPassword: 'p"ass\\word',
        storage: {},
      })

      expect(result.context.serverPassword).toBe('p"ass\\word')
    })
  })
})