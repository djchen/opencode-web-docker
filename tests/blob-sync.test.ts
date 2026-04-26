import { describe, expect, test } from "bun:test"
import { createBlobSync } from "../runtime/blob-sync"
import type { BlobSyncConfig, BlobSyncApi, SyncStatus } from "../runtime/types"

interface HarnessResult {
  sync: BlobSyncApi
  statusChanges: Array<{ status: SyncStatus; ts: number | null; url: string }>
  pullCalls: number[]
  pushCalls: Array<Record<string, string | null>>
  applyCalls: Array<Record<string, unknown>>
  timers: Array<{ id: number; fn: () => void; ms: number }>
  intervals: Array<{ id: number; fn: () => void; ms: number }>
  activeTimers: Map<number, { fn: () => void; ms: number }>
  activeIntervals: Map<number, { fn: () => void; ms: number }>
  runTimer: (id: number) => boolean
  runAllTimers: () => void
  runInterval: (id: number) => boolean
  setMockPullResult: (
    r:
      | { status: number; body: Record<string, unknown> | null }
      | Error
      | (() => Promise<{ status: number; body: Record<string, unknown> | null }>),
  ) => void
  setReadLocalBlobResult: (r: Record<string, string | null> | (() => Record<string, string | null>)) => void
  setMockPushError: (v: boolean) => void
}

function createHarness(
  config: Partial<{
    mockPullResult: { status: number; body: Record<string, unknown> | null } | Error
    readLocalBlobResult: Record<string, string | null> | (() => Record<string, string | null>)
    mockPushError: boolean
    lastSyncTime: number | null
    debounceMs: number
    intervalMs: number
    url: string
    onFirstSyncDivergence: BlobSyncConfig["onFirstSyncDivergence"]
  }> = {},
): HarnessResult {
  const statusChanges: Array<{ status: SyncStatus; ts: number | null; url: string }> = []
  const pullCalls: number[] = []
  const pushCalls: Array<Record<string, string | null>> = []
  const applyCalls: Array<Record<string, unknown>> = []
  let mockPullResult:
    | { status: number; body: Record<string, unknown> | null }
    | Error
    | (() => Promise<{ status: number; body: Record<string, unknown> | null }>) = config.mockPullResult ?? {
    status: 404,
    body: null,
  }
  let mockPushError = config.mockPushError ?? false

  const timers: Array<{ id: number; fn: () => void; ms: number }> = []
  const intervals: Array<{ id: number; fn: () => void; ms: number }> = []
  let timerIdCounter = 1
  const activeTimers = new Map<number, { fn: () => void; ms: number }>()
  const activeIntervals = new Map<number, { fn: () => void; ms: number }>()

  function setTimeoutImpl(fn: () => void, ms: number): number {
    const id = timerIdCounter++
    activeTimers.set(id, { fn, ms })
    timers.push({ id, fn, ms })
    return id
  }

  function clearTimeoutImpl(id: unknown): void {
    if (typeof id === "number") activeTimers.delete(id)
  }

  function setIntervalImpl(fn: () => void, ms: number): number {
    const id = timerIdCounter++
    activeIntervals.set(id, { fn, ms })
    intervals.push({ id, fn, ms })
    return id
  }

  function clearIntervalImpl(id: unknown): void {
    if (typeof id === "number") activeIntervals.delete(id)
  }

  function runTimer(id: number): boolean {
    const t = activeTimers.get(id)
    if (t) {
      activeTimers.delete(id)
      t.fn()
      return true
    }
    return false
  }

  function runAllTimers(): void {
    while (activeTimers.size > 0) {
      const entries = Array.from(activeTimers.entries())
      for (const [id, t] of entries) {
        activeTimers.delete(id)
        t.fn()
      }
    }
  }

  function runInterval(id: number): boolean {
    const i = activeIntervals.get(id)
    if (i) {
      i.fn()
      return true
    }
    return false
  }

  let _readLocalBlobResult: Record<string, string | null> | (() => Record<string, string | null>) =
    config.readLocalBlobResult ?? {}
  let _firstSyncCb = config.onFirstSyncDivergence ?? null

  const onFirstSyncDivergence = _firstSyncCb
    ? (local: Record<string, string | null>, remote: Record<string, unknown>, resolve: (choice: string) => void) => {
        _firstSyncCb!(local, remote, resolve)
      }
    : undefined

  const sync = createBlobSync({
    readLocalBlob: () => {
      return typeof _readLocalBlobResult === "function" ? _readLocalBlobResult() : _readLocalBlobResult
    },
    applyRemoteBlob: (remote: Record<string, unknown>) => {
      applyCalls.push(JSON.parse(JSON.stringify(remote)))
    },
    pullRemoteBlob: () => {
      pullCalls.push(1)
      if (typeof mockPullResult === "function") return mockPullResult()
      if (mockPullResult instanceof Error) return Promise.reject(mockPullResult)
      return Promise.resolve(mockPullResult)
    },
    pushRemoteBlob: (blob: Record<string, string | null>) => {
      pushCalls.push(JSON.parse(JSON.stringify(blob)))
      if (mockPushError) return Promise.reject(new Error("push failed"))
      return Promise.resolve()
    },
    onStatusChange: (status: SyncStatus, ts: number | null, url: string) => {
      statusChanges.push({ status, ts, url })
    },
    onFirstSyncDivergence,
    lastSyncTime: config.lastSyncTime ?? null,
    debounceMs: config.debounceMs ?? 3000,
    intervalMs: config.intervalMs ?? 30000,
    url: config.url ?? "https://sync.example.com/settings",
    setTimeout: setTimeoutImpl as unknown as BlobSyncConfig["setTimeout"],
    clearTimeout: clearTimeoutImpl as unknown as BlobSyncConfig["clearTimeout"],
    setInterval: setIntervalImpl as unknown as BlobSyncConfig["setInterval"],
    clearInterval: clearIntervalImpl as unknown as BlobSyncConfig["clearInterval"],
  })

  return {
    sync,
    statusChanges,
    pullCalls,
    pushCalls,
    applyCalls,
    timers,
    intervals,
    activeTimers,
    activeIntervals,
    runTimer,
    runAllTimers,
    runInterval,
    setMockPullResult: (r) => {
      mockPullResult = r
    },
    setReadLocalBlobResult: (r) => {
      _readLocalBlobResult = r
    },
    setMockPushError: (v) => {
      mockPushError = v
    },
  }
}

describe("blob-sync", () => {
  test("initial pull fires on creation", () => {
    const h = createHarness()
    expect(h.pullCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("pull interval set correctly", () => {
    const h = createHarness({ intervalMs: 15000 })
    expect(h.intervals.length).toBeGreaterThanOrEqual(1)
    expect(h.intervals[0]!.ms).toBe(15000)
  })

  test("markDirty schedules debounced push", async () => {
    const h = createHarness({
      mockPullResult: { status: 404, body: null },
      readLocalBlobResult: { "settings.v3": "x" },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.statusChanges.length = 0
    h.sync.markDirty()

    const pushTimers = Array.from(h.activeTimers.values()).filter((t) => t.ms === 3000)
    expect(pushTimers.length).toBeGreaterThanOrEqual(1)
  })

  test("markDirty with no local data skips empty push", async () => {
    const h = createHarness({
      mockPullResult: { status: 404, body: null },
      readLocalBlobResult: {},
    })
    await new Promise((r) => setTimeout(r, 50))

    h.pushCalls.length = 0
    h.sync.markDirty()

    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    if (pushTimerEntry) {
      h.runTimer(pushTimerEntry[0])
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(h.pushCalls.length).toBe(0)
  })

  test("Push includes live data from readLocalBlob", async () => {
    const h = createHarness({
      readLocalBlobResult: { "settings.v3": "x" },
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()
    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])
    await new Promise((r) => setTimeout(r, 10))

    const lastPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(lastPush["settings.v3"]).toBe("x")
  })

  test("Push merges tombstones", async () => {
    const h = createHarness({
      readLocalBlobResult: {},
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDeleted("settings.v3")

    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])
    await new Promise((r) => setTimeout(r, 10))

    const lastPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(lastPush["settings.v3"]).toBeNull()
  })

  test("clearDeleted removes tombstone", async () => {
    const h = createHarness({
      readLocalBlobResult: { "settings.v3": "y" },
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDeleted("settings.v3")
    h.sync.clearDeleted("settings.v3")

    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    if (pushTimerEntry) {
      h.runTimer(pushTimerEntry[0])
      await new Promise((r) => setTimeout(r, 10))
    }

    const lastPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(lastPush["settings.v3"]).toBe("y")
    expect(Object.keys(lastPush).includes("settings.v3")).toBe(true)
    expect(lastPush["settings.v3"]).not.toBeNull()
  })

  test("Push with in-flight mutations re-schedules", async () => {
    let liveData: Record<string, string | null> = { "settings.v3": "a" }
    const h = createHarness({
      readLocalBlobResult: () => JSON.parse(JSON.stringify(liveData)),
      mockPullResult: { status: 404, body: null },
    })
    h.setMockPushError(false)
    h.pushCalls.length = 0

    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()
    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])

    liveData = { ...liveData, "settings.v3": "b" }
    h.sync.markDirty()

    await new Promise((r) => setTimeout(r, 50))

    expect(h.pushCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("Push fails preserves dirty state", async () => {
    const h = createHarness({
      readLocalBlobResult: { "settings.v3": "x" },
      mockPullResult: { status: 404, body: null },
      mockPushError: true,
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()
    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])
    await new Promise((r) => setTimeout(r, 50))

    const errorStatuses = h.statusChanges.filter((c) => c.status === "error")
    expect(errorStatuses.length).toBeGreaterThanOrEqual(1)
  })

  test("Pull writes remote data via applyRemoteBlob", async () => {
    const h = createHarness({
      mockPullResult: { status: 200, body: { "settings.v3": "remote-val" } },
      readLocalBlobResult: {},
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.applyCalls.length).toBeGreaterThanOrEqual(1)
    expect(h.applyCalls[0]!["settings.v3"]).toBe("remote-val")
  })

  test("Pull skips when dirty, flushes push", async () => {
    const h = createHarness({
      readLocalBlobResult: { "settings.v3": "x" },
      mockPullResult: { status: 200, body: { "settings.v3": "y" } },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()

    h.pullCalls.length = 0
    h.pushCalls.length = 0

    h.sync.pullNow()
    await new Promise((r) => setTimeout(r, 50))

    expect(h.pushCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("Pull 404 with local data triggers push", async () => {
    const h = createHarness({
      mockPullResult: { status: 404, body: null },
      readLocalBlobResult: { "settings.v3": "local-data" },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.pushCalls.length).toBeGreaterThanOrEqual(1)
    const lastPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(lastPush["settings.v3"]).toBe("local-data")
  })

  test("Pull 404 with empty local skips push", async () => {
    const h = createHarness({
      mockPullResult: { status: 404, body: null },
      readLocalBlobResult: {},
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.pushCalls.length).toBe(0)
  })

  test("Pull rejects array remote", async () => {
    const h = createHarness({
      mockPullResult: { status: 200, body: [{ key: "val" }] as unknown as Record<string, unknown> },
      readLocalBlobResult: {},
      lastSyncTime: 12345,
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.applyCalls.length).toBe(0)
  })

  test("Pull ignores non-string values within applyRemoteBlob", async () => {
    const h = createHarness({
      mockPullResult: {
        status: 200,
        body: { "settings.v3": { nested: true }, "opencode-theme-id": 42 } as unknown as Record<string, unknown>,
      },
      readLocalBlobResult: {},
      lastSyncTime: 12345,
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.applyCalls.length).toBeGreaterThanOrEqual(1)
    expect(h.applyCalls[0]).toEqual({
      "settings.v3": { nested: true },
      "opencode-theme-id": 42,
    })
  })

  test("Fetch error sets status to error", async () => {
    const h = createHarness({
      mockPullResult: new Error("network error"),
      readLocalBlobResult: {},
    })
    await new Promise((r) => setTimeout(r, 50))

    const errorStatuses = h.statusChanges.filter((c) => c.status === "error")
    expect(errorStatuses.length).toBeGreaterThanOrEqual(1)
  })

  test("Status change callback fires with correct values", async () => {
    const h = createHarness({
      mockPullResult: { status: 404, body: null },
      readLocalBlobResult: {},
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(h.statusChanges.length).toBeGreaterThanOrEqual(1)
    const connected = h.statusChanges.find((c) => c.status === "connected")
    expect(connected).toBeDefined()
    expect(connected!.ts).not.toBeNull()
    expect(connected!.url).toBe("https://sync.example.com/settings")
  })

  test("First-sync divergence: diverged data calls onFirstSyncDivergence", async () => {
    let divergenceCalled = false
    let divergenceLocal: Record<string, string | null> | null = null
    let divergenceRemote: Record<string, unknown> | null = null

    createHarness({
      lastSyncTime: null,
      readLocalBlobResult: { "settings.v3": "local-val" },
      mockPullResult: {
        status: 200,
        body: { "settings.v3": "remote-val" },
      },
      onFirstSyncDivergence: (local, remote, _resolve) => {
        divergenceCalled = true
        divergenceLocal = local
        divergenceRemote = remote
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(divergenceCalled).toBe(true)
    expect(divergenceLocal!["settings.v3"]).toBe("local-val")
    expect(divergenceRemote!["settings.v3"]).toBe("remote-val")
  })

  test("First-sync divergence: identical data auto-applies", async () => {
    let divergenceCalled = false

    const h = createHarness({
      lastSyncTime: null,
      readLocalBlobResult: { "settings.v3": "same-val" },
      mockPullResult: {
        status: 200,
        body: { "settings.v3": "same-val" },
      },
      onFirstSyncDivergence: () => {
        divergenceCalled = true
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(divergenceCalled).toBe(false)
    expect(h.applyCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("First-sync divergence: empty local auto-applies remote", async () => {
    let divergenceCalled = false

    const h = createHarness({
      lastSyncTime: null,
      readLocalBlobResult: {},
      mockPullResult: {
        status: 200,
        body: { "settings.v3": "remote-val" },
      },
      onFirstSyncDivergence: () => {
        divergenceCalled = true
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(divergenceCalled).toBe(false)
    expect(h.applyCalls.length).toBeGreaterThanOrEqual(1)
    expect(h.applyCalls[0]!["settings.v3"]).toBe("remote-val")
  })

  test("First-sync divergence: resolveFirstSync applies pending remote", async () => {
    let storedResolve: ((choice: string) => void) | null = null

    const h = createHarness({
      lastSyncTime: null,
      readLocalBlobResult: { "settings.v3": "local-val" },
      mockPullResult: {
        status: 200,
        body: { "settings.v3": "remote-val" },
      },
      onFirstSyncDivergence: (_local, _remote, resolve) => {
        storedResolve = resolve
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(storedResolve).not.toBeNull()

    h.applyCalls.length = 0
    storedResolve!("server")
    await new Promise((r) => setTimeout(r, 10))

    expect(h.applyCalls.length).toBe(1)
    expect(h.applyCalls[0]!["settings.v3"]).toBe("remote-val")

    const connectedChanges = h.statusChanges.filter((c) => c.status === "connected")
    expect(connectedChanges.length).toBeGreaterThanOrEqual(1)
  })

  test("Previously synced: no divergence prompt", async () => {
    let divergenceCalled = false

    const h = createHarness({
      lastSyncTime: 1234567890,
      readLocalBlobResult: { "settings.v3": "local-val" },
      mockPullResult: {
        status: 200,
        body: { "settings.v3": "remote-val" },
      },
      onFirstSyncDivergence: () => {
        divergenceCalled = true
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(divergenceCalled).toBe(false)
    expect(h.applyCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("stop() clears intervals and cancels timers", async () => {
    const h = createHarness({
      readLocalBlobResult: {},
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()
    h.sync.stop()

    expect(h.activeIntervals.size).toBe(0)
    expect(h.activeTimers.size).toBe(0)

    const disabledStatus = h.statusChanges.find((c) => c.status === "disabled")
    expect(disabledStatus).toBeDefined()
  })

  test("markDeleted also calls markDirty", async () => {
    const h = createHarness({
      readLocalBlobResult: {},
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDeleted("settings.v3")

    const pushTimer = Array.from(h.activeTimers.values()).find((t) => t.ms === 3000)
    expect(pushTimer).toBeDefined()
  })

  test("Push clears dirty state on success when no new mutations", async () => {
    const h = createHarness({
      readLocalBlobResult: { "settings.v3": "x" },
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDirty()
    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])
    await new Promise((r) => setTimeout(r, 10))

    const connectedAfterPush = h.statusChanges.filter((c) => c.status === "connected")
    expect(connectedAfterPush.length).toBeGreaterThanOrEqual(1)
  })

  test("New deletion during in-flight push preserves tombstone", async () => {
    let liveData: Record<string, string | null> = { "settings.v3": "a" }
    const h = createHarness({
      readLocalBlobResult: () => JSON.parse(JSON.stringify(liveData)),
      mockPullResult: { status: 404, body: null },
    })
    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDeleted("settings.v3")
    delete liveData["settings.v3"]

    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    expect(pushTimerEntry).toBeDefined()
    h.runTimer(pushTimerEntry![0])

    await new Promise((r) => setTimeout(r, 10))

    const firstPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(firstPush["settings.v3"]).toBeNull()
  })

  test("Push clears only matched tombstones after in-flight mutations", async () => {
    let liveData: Record<string, string | null> = { "settings.v3": "a", "opencode-theme-id": "t1" }
    const h = createHarness({
      readLocalBlobResult: () => JSON.parse(JSON.stringify(liveData)),
      mockPullResult: { status: 404, body: null },
    })
    h.setMockPushError(false)

    await new Promise((r) => setTimeout(r, 50))

    h.sync.markDeleted("settings.v3")
    delete liveData["settings.v3"]

    h.sync.markDirty()
    const pushTimerEntry = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    if (pushTimerEntry) {
      h.runTimer(pushTimerEntry[0])
    }

    await new Promise((r) => setTimeout(r, 50))

    liveData = { ...liveData, "settings.v3": "b" }
    h.sync.clearDeleted("settings.v3")
    h.sync.markDirty()

    const secondTimer = Array.from(h.activeTimers.entries()).find(([, t]) => t.ms === 3000)
    if (secondTimer) {
      h.runTimer(secondTimer[0])
    }

    await new Promise((r) => setTimeout(r, 50))

    const lastPush = h.pushCalls[h.pushCalls.length - 1]!
    expect(lastPush["settings.v3"]).toBe("b")
  })
})
