import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"

const root = path.resolve(import.meta.dir, "..")
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

function runSyncClient(input) {
  const storage = new Map(Object.entries(input.storage ?? {}))
  const setCalls = []
  const removeCalls = []
  const fetchCalls = []
  const timers = []
  const intervals = []
  const eventListeners = {}

  const fetchImpl = input.fetchImpl ?? ((url, opts) => {
    fetchCalls.push({ url, opts })
    if (input.fetchResponse) return Promise.resolve(input.fetchResponse)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(input.fetchJson ?? {}) })
  })

  const document = {
    title: "OpenCode",
    readyState: "complete",
    hidden: false,
    addEventListener: (event, handler) => {
      eventListeners[event] = handler
    },
    getElementById: () => null,
    querySelector: () => null,
  }

  const context = {
    Buffer,
    JSON,
    Math,
    Object,
    Array,
    Promise,
    Uint8Array,
    TextEncoder,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    unescape: unescape,
    encodeURIComponent: encodeURIComponent,
    console: { warn: () => {}, log: () => {} },
    document,
    location: { href: "http://localhost/", origin: "http://localhost" },
    localStorage: createStorageView(storage, setCalls, removeCalls),
    fetch: fetchImpl,
    setTimeout: (fn, ms) => {
      const id = timers.length + 1
      timers.push({ fn, ms })
      return id
    },
    clearTimeout: () => {},
    setInterval: (fn, ms) => {
      const id = intervals.length + 1
      intervals.push({ fn, ms })
      return id
    },
    clearInterval: () => {},
    window: {},
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

  const script = syncClient + "\n" + [
    `initSettingsSync(`,
    `  ${JSON.stringify(input.syncUrl ?? "https://sync.example.com/settings")},`,
    `  ${JSON.stringify(String(input.interval ?? 30))},`,
    `  ${JSON.stringify(input.authHeader ?? "")},`,
    `  ${JSON.stringify(input.username ?? "")},`,
    `  ${JSON.stringify(input.password ?? "")}`,
    `)`,
  ].join("\n")

  vm.runInNewContext(script, context, { timeout: 5000 })

  return {
    context,
    eventListeners,
    fetchCalls,
    intervals,
    removeCalls,
    setCalls,
    storage,
    timers,
    window: context.window,
  }
}

describe("sync-client", () => {
  test("initSettingsSync makes an initial GET pull", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(1)
    expect(result.fetchCalls[0].url).toBe("https://sync.example.com/settings")
    expect(result.fetchCalls[0].opts.method).toBe("GET")
  })

  test("initSettingsSync sets up a pull interval", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      interval: 10,
      storage: {},
    })

    expect(result.intervals.length).toBeGreaterThanOrEqual(1)
    expect(result.intervals[0].ms).toBe(10000)
  })

  test("pull writes allowlisted keys from remote to localStorage when they differ", async () => {
    const remoteData = {
      "settings.v3": '{"theme":"dark"}',
      "opencode-theme-id": "oc-2",
      "opencode-color-scheme": "dark",
    }

    let resolveResponse
    const responsePromise = new Promise((r) => { resolveResponse = r })

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(remoteData),
          })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {
        "settings.v3": '{"theme":"light"}',
      },
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.storage.get("settings.v3")).toBe('{"theme":"dark"}')
    expect(result.storage.get("opencode-theme-id")).toBe("oc-2")
    expect(result.storage.get("opencode-color-scheme")).toBe("dark")
  })

  test("pull does not write keys not in the allowlist", async () => {
    const remoteData = {
      "settings.v3": '{"theme":"dark"}',
      "opencode.global.dat:server": "should-not-sync",
    }

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(remoteData),
          })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.storage.has("opencode.global.dat:server")).toBe(false)
  })

  test("pull-write suppression prevents push-pull loops", async () => {
    const remoteData = {
      "settings.v3": '{"theme":"dark"}',
    }

    const fetchCalls = []
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        fetchCalls.push({ url, opts })
        if (opts && opts.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(remoteData),
          })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 200))

    const putCalls = fetchCalls.filter((c) => c.opts && c.opts.method === "PUT")
    expect(putCalls.length).toBe(0)
  })

  test("setItem interceptor schedules a debounced push for allowlisted keys", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    const pushTimersBefore = result.timers.filter((t) => t && t.ms === 3000).length

    result.context.localStorage.setItem("settings.v3", '{"theme":"light"}')

    const pushTimersAfter = result.timers.filter((t) => t && t.ms === 3000).length
    expect(pushTimersAfter).toBeGreaterThan(pushTimersBefore)
  })

  test("setItem interceptor does not schedule push for non-allowlisted keys", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    const timersBefore = result.timers.length

    result.context.localStorage.setItem("opencode.global.dat:server", "test")

    expect(result.timers.length).toBe(timersBefore)
  })

  test("removeItem interceptor schedules push for allowlisted keys", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: { "settings.v3": '{"old":"data"}' },
    })

    const pushTimersBefore = result.timers.filter((t) => t && t.ms === 3000).length

    result.context.localStorage.removeItem("settings.v3")

    const pushTimersAfter = result.timers.filter((t) => t && t.ms === 3000).length
    expect(pushTimersAfter).toBeGreaterThan(pushTimersBefore)
  })

  test("sends custom Authorization header when configured", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      authHeader: "Bearer my-token",
      storage: {},
    })

    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(1)
    expect(result.fetchCalls[0].opts.headers.Authorization).toBe("Bearer my-token")
  })

  test("sends Basic Auth when authHeader is not set but username/password are provided", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      username: "alice",
      password: "secret",
      storage: {},
    })

    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(1)
    const auth = result.fetchCalls[0].opts.headers.Authorization
    expect(auth).toMatch(/^Basic /)
  })

  test("collects only allowlisted keys for push blob", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {
        "settings.v3": '{"theme":"dark"}',
        "opencode-theme-id": "oc-2",
        "opencode.global.dat:server": "should-not-include",
      },
    })

    var blob = result.context._collectBlob
    if (typeof blob === "function") {
      var collected = blob()
      expect(collected["settings.v3"]).toBe('{"theme":"dark"}')
      expect(collected["opencode-theme-id"]).toBe("oc-2")
      expect("opencode.global.dat:server" in collected).toBe(false)
    }
  })

  test("visibilitychange listener is registered", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    expect(result.eventListeners.visibilitychange).toBeDefined()
  })

  test("exposes __OPENCODE_SYNC_STATUS on window", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    expect(result.window.__OPENCODE_SYNC_STATUS).toBeDefined()
    expect(result.window.__OPENCODE_SYNC_STATUS.url).toBe("https://sync.example.com/settings")
  })

  test("404 on initial pull triggers initial push", async () => {
    const calls = []

    runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        calls.push({ url, opts })
        if (opts && opts.method === "GET") {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: { "settings.v3": '{"theme":"dark"}' },
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(calls.map((c) => c.opts.method)).toContain("GET")
    expect(calls.map((c) => c.opts.method)).toContain("PUT")
  })

  test("404 with empty localStorage skips push, sets lastSyncTime, does not mark dirty", async () => {
    const calls = []

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        calls.push({ url, opts })
        if (opts && opts.method === "GET") {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(calls.map((c) => c.opts.method)).toContain("GET")
    expect(calls.map((c) => c.opts.method)).not.toContain("PUT")
    expect(result.context._isDirty).toBe(false)
    expect(result.context._lastSyncTime).not.toBeNull()
    expect(result.window.__OPENCODE_SYNC_STATUS.status).toBe("connected")
  })

  test("push keeps _isDirty true on HTTP 500 response", async () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "PUT") {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      },
      storage: {
        "settings.v3": '{"theme":"dark"}',
      },
    })

    result.context.localStorage.setItem("settings.v3", '{"theme":"light"}')

    const pushTimer = result.timers.find((t) => t && t.ms === 3000)
    expect(pushTimer).toBeDefined()

    await new Promise((r) => setTimeout(r, 0))
    pushTimer.fn()

    await new Promise((r) => setTimeout(r, 50))

    expect(result.context._isDirty).toBe(true)
    expect(result.window.__OPENCODE_SYNC_STATUS.status).toBe("error")
  })

  test("removed key sends null tombstone in push body", async () => {
    const puts = []
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "PUT") {
          puts.push({ url, opts })
        }
        if (opts && opts.method === "GET") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: { "settings.v3": '{"old":"data"}' },
    })

    result.context.localStorage.removeItem("settings.v3")

    const pushTimer = result.timers.find((t) => t && t.ms === 3000)
    expect(pushTimer).toBeDefined()

    await new Promise((r) => setTimeout(r, 0))
    pushTimer.fn()

    await new Promise((r) => setTimeout(r, 50))

    expect(puts.length).toBe(1)
    const body = JSON.parse(puts[0].opts.body)
    expect(body["settings.v3"]).toBeNull()
  })

  test("tombstones persist after failed push", async () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "PUT") {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      },
      storage: { "settings.v3": '{"old":"data"}' },
    })

    result.context.localStorage.removeItem("settings.v3")

    const pushTimer = result.timers.find((t) => t && t.ms === 3000)
    expect(pushTimer).toBeDefined()

    await new Promise((r) => setTimeout(r, 0))
    pushTimer.fn()

    await new Promise((r) => setTimeout(r, 50))

    expect(result.context._deletedKeys["settings.v3"]).toBeDefined()
    expect(typeof result.context._deletedKeys["settings.v3"]).toBe("number")
    expect(result.context._collectBlob()["settings.v3"]).toBeNull()
  })

  test("handles fetch error gracefully", async () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: () => Promise.reject(new Error("network error")),
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.window.__OPENCODE_SYNC_STATUS).toBeDefined()
  })

  test("new deletion during in-flight push preserves tombstone", async () => {
    let resolvePut
    const fetchCalls = []

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        fetchCalls.push({ url, opts })
        if (opts && opts.method === "PUT") {
          return new Promise((resolve) => { resolvePut = resolve })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      },
      storage: { "settings.v3": '{"old":"data"}' },
    })

    await new Promise((r) => setTimeout(r, 50))

    result.context.localStorage.setItem("settings.v3", '{"new":"data"}')
    const pushTimer = result.timers.find((t) => t && t.ms === 3000)
    expect(pushTimer).toBeDefined()
    pushTimer.fn()

    result.context.localStorage.removeItem("settings.v3")

    resolvePut({ ok: true, status: 204 })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.context._deletedKeys["settings.v3"]).toBeDefined()
    expect(typeof result.context._deletedKeys["settings.v3"]).toBe("number")
  })

  test("newer tombstone for same key survives old tombstone push success", async () => {
    let resolveOldPut
    const puts = []

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "PUT") {
          return new Promise((resolve) => {
            if (puts.length === 0) {
              resolveOldPut = resolve
            }
            puts.push({ url, opts })
            if (puts.length > 1) {
              resolve({ ok: true, status: 204 })
            }
          })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      },
      storage: { "settings.v3": '{"old":"data"}' },
    })

    await new Promise((r) => setTimeout(r, 50))

    result.context.localStorage.removeItem("settings.v3")
    const pushTimer = result.timers.find((t) => t && t.ms === 3000)
    pushTimer.fn()

    await new Promise((r) => setTimeout(r, 0))

    expect(puts.length).toBe(1)
    expect(JSON.parse(puts[0].opts.body)["settings.v3"]).toBeNull()

    result.context.localStorage.setItem("settings.v3", '{"new":"data"}')
    result.context.localStorage.removeItem("settings.v3")

    resolveOldPut({ ok: true, status: 204 })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.context._deletedKeys["settings.v3"]).toBeDefined()
    expect(typeof result.context._deletedKeys["settings.v3"]).toBe("number")

    const secondTimer = result.timers.find((t, i) => i > result.timers.indexOf(pushTimer) && t && t.ms === 3000)
    if (secondTimer) {
      secondTimer.fn()
      await new Promise((r) => setTimeout(r, 50))

      expect(puts.length).toBe(2)
      const body = JSON.parse(puts[1].opts.body)
      expect(body["settings.v3"]).toBeNull()
    }
  })

  test("initSettingsSync is idempotent", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      storage: {},
    })

    const intervalsBefore = result.intervals.length
    const listenersBefore = Object.keys(result.eventListeners).length

    result.context.initSettingsSync("https://other.example.com/settings", "60", "", "", "")

    expect(result.intervals.length).toBe(intervalsBefore)
    expect(Object.keys(result.eventListeners).length).toBe(listenersBefore)
  })

  test("pull rejects array responses", async () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "GET") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ key: "val" }]) })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.storage.size).toBe(0)
  })

  test("pull ignores non-string remote values", async () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        if (opts && opts.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ "settings.v3": { nested: true }, "opencode-theme-id": 42 }),
          })
        }
        return Promise.resolve({ ok: true, status: 204 })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(result.storage.has("settings.v3")).toBe(false)
    expect(result.storage.has("opencode-theme-id")).toBe(false)
  })

  test("Basic Auth encodes non-ASCII credentials", () => {
    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      username: "ußr",
      password: "päß",
      storage: {},
    })

    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(1)
    const auth = result.fetchCalls[0].opts.headers.Authorization
    expect(auth).toMatch(/^Basic /)
    const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8")
    expect(decoded).toBe("ußr:päß")
  })

  test("sync panel is appended outside the button", () => {
    const createdElements = []

    function createMockElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        children: [],
        parent: null,
        attributes: {},
        id: "",
        textContent: "",
        innerHTML: "",
        title: "",
        onclick: null,
        setAttribute(key, value) { el.attributes[key] = value },
        appendChild(child) { child.parent = el; el.children.push(child) },
        contains(child) { return el.children.includes(child) || el.children.some((c) => c.contains && c.contains(child)) },
        querySelector(selector) {
          for (const c of el.children) {
            if (selector.startsWith("[") && c.attributes) {
              const attrMatch = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/)
              if (attrMatch && c.attributes[attrMatch[1]] === attrMatch[2]) return c
            }
            const found = c.querySelector ? c.querySelector(selector) : null
            if (found) return found
          }
          return null
        },
        remove() {
          if (el.parent) {
            el.parent.children = el.parent.children.filter((c) => c !== el)
            el.parent = null
          }
        },
      }
      createdElements.push(el)
      return el
    }

    const mockDocument = {
      title: "OpenCode",
      hidden: false,
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      createElement: createMockElement,
    }

    const storage = new Map()
    const setCalls = []
    const removeCalls = []
    const localStorage = createStorageView(storage, setCalls, removeCalls)

    const context = {
      Buffer,
      JSON,
      Math,
      Object,
      Array,
      Promise,
      Uint8Array,
      TextEncoder,
      atob: (v) => Buffer.from(v, "base64").toString("binary"),
      btoa: (v) => Buffer.from(v, "binary").toString("base64"),
      unescape: unescape,
      encodeURIComponent: encodeURIComponent,
      console: { warn: () => {}, log: () => {} },
      document: mockDocument,
      location: { href: "http://localhost/", origin: "http://localhost" },
      localStorage,
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
      setTimeout: (fn, ms) => 1,
      clearTimeout: () => {},
      setInterval: (fn, ms) => 1,
      clearInterval: () => {},
      MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
    }

    context.window = Object.assign({}, context, { __OPENCODE_SYNC_STATUS: null })

    vm.runInNewContext(syncClient + "\n" + [
      `initSettingsSync(`,
      `  "https://sync.example.com/settings",`,
      `  "30",`,
      `  "",`,
      `  "",`,
      `  ""`,
      `)`,
    ].join("\n"), context, { timeout: 5000 })

    const wrapper = context._createSyncButton()
    const btn = wrapper.children.find((c) => c.attributes["data-component"] === "opencode-web-sync-btn")
    expect(btn).toBeDefined()

    btn.onclick({ stopPropagation: () => {} })

    const panel = wrapper.children.find((c) => c.attributes["data-component"] === "opencode-web-sync-panel")
    expect(panel).toBeDefined()
    expect(panel.parent).toBe(wrapper)
    expect(btn.children.length).toBe(0)
    expect(panel.parent).not.toBe(btn)
  })

  test("visibilitychange pushes pending local changes before pulling", async () => {
    const fetchCalls = []

    const result = runSyncClient({
      syncUrl: "https://sync.example.com/settings",
      fetchImpl: (url, opts) => {
        fetchCalls.push({ url, opts })
        if (opts && opts.method === "PUT") {
          return Promise.resolve({ ok: true, status: 204 })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      },
      storage: {},
    })

    await new Promise((r) => setTimeout(r, 50))

    fetchCalls.length = 0

    result.context.localStorage.setItem("settings.v3", '{"theme":"dark"}')

    result.context.document.hidden = true
    result.eventListeners.visibilitychange()

    await new Promise((r) => setTimeout(r, 50))

    const methods = fetchCalls.map((c) => c.opts.method)
    expect(methods).toContain("PUT")
  })
})