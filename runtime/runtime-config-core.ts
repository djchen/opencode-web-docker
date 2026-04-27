import type { RuntimeConfigDeps, ServerListItem, ServerState } from "./types"

const defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl"
const serverStoreKey = "opencode.global.dat:server"

function warnIncompatibleStore(deps: RuntimeConfigDeps, reason: string) {
  deps.console.warn(
    "OpenCode runtime-config may be incompatible with this upstream build:",
    reason,
    "Review runtime/entrypoint.sh and runtime/runtime-config-core.ts against upstream app persistence.",
  )
}

function normalizeUrl(input: unknown): string {
  if (typeof input !== "string") return ""
  const trimmed = input.trim()
  if (!trimmed) return ""
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

function readState(deps: RuntimeConfigDeps): { raw: string | null; state: ServerState } {
  const raw = deps.localStorage.getItem(serverStoreKey)
  const empty: ServerState = { list: [], projects: {}, lastProject: {} }

  try {
    const parsed = JSON.parse(raw || "null") as ServerState | null
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (parsed !== null) warnIncompatibleStore(deps, "server store is not an object")
      return { raw, state: empty }
    }

    if (!Array.isArray(parsed.list)) {
      warnIncompatibleStore(deps, "server store list is not an array")
      parsed.list = []
    }
    if (!parsed.projects || typeof parsed.projects !== "object") {
      warnIncompatibleStore(deps, "server store projects is not an object")
      parsed.projects = {}
    }
    if (!parsed.lastProject || typeof parsed.lastProject !== "object") {
      warnIncompatibleStore(deps, "server store lastProject is not an object")
      parsed.lastProject = {}
    }

    return { raw, state: parsed }
  } catch {
    warnIncompatibleStore(deps, "failed to parse persisted server store JSON")
    return { raw, state: { ...empty } }
  }
}

function storedUrl(item: unknown): string {
  if (typeof item === "string") return normalizeUrl(item)
  if (!item || typeof item !== "object") return ""
  const obj = item as Record<string, unknown>
  if (obj.type && obj.http && typeof (obj.http as Record<string, unknown>).url === "string") {
    return normalizeUrl((obj.http as Record<string, unknown>).url as string)
  }
  if (typeof obj.url === "string") return normalizeUrl(obj.url)
  return ""
}

interface ExistingStateIndex {
  byUrl: Record<string, ServerListItem>
  entries: Array<{ item: ServerListItem; url: string }>
}

function buildExistingStateIndex(list: ServerListItem[]): ExistingStateIndex {
  const byUrl: Record<string, ServerListItem> = Object.create(null)
  const entries: ExistingStateIndex["entries"] = []

  for (let i = 0; i < list.length; i++) {
    const item = list[i]!
    const url = storedUrl(item)
    if (url && !byUrl[url]) byUrl[url] = item
    entries.push({ item, url })
  }

  return { byUrl, entries }
}

function buildConfiguredServers(existingByUrl: Record<string, ServerListItem>) {
  const configuredUrls: Record<string, boolean> = Object.create(null)
  const mergedConfigured: ServerListItem[] = []

  for (let i = 0; i < configuredServers.length; i++) {
    const server = configuredServers[i]
    if (!server) continue
    const serverUrl = normalizeUrl(_b64d(server.url))
    if (!serverUrl) continue

    configuredUrls[serverUrl] = true

    const existing = existingByUrl[serverUrl]
    const next: ServerListItem & { http: Record<string, string> } = { type: "http", http: { url: serverUrl } }

    if (existing && typeof existing === "object") {
      if (typeof existing.displayName === "string") next.displayName = existing.displayName
      if (existing.http && typeof existing.http === "object") {
        if (typeof existing.http.username === "string") next.http.username = existing.http.username
        if (typeof existing.http.password === "string") next.http.password = existing.http.password
      }
    }

    const serverName = _b64d(server.name).trim()
    const serverUsername = _b64d(server.username).trim()
    const serverPassword = _b64d(server.password)

    if (serverName) next.displayName = serverName
    if (serverUsername) next.http.username = serverUsername
    if (serverPassword) next.http.password = serverPassword

    mergedConfigured.push(next)
  }

  return { configuredUrls, mergedConfigured }
}

function listHasUrl(list: ServerListItem[], url: string): boolean {
  return list.some((item) => storedUrl(item) === url)
}

export function initRuntimeConfig(deps?: Partial<RuntimeConfigDeps>): void {
  const d: RuntimeConfigDeps = {
    localStorage: deps?.localStorage ?? localStorage,
    document: deps?.document ?? document,
    location: deps?.location ?? location,
    window: deps?.window ?? (window as Window & typeof globalThis),
    console: deps?.console ?? console,
  }

  try {
    const nextTitle = _b64d(appTitle).trim()
    if (nextTitle) {
      d.document.title = nextTitle
    }

    const persisted = readState(d)
    const state = persisted.state
    const indexedState = buildExistingStateIndex(state.list)
    const { configuredUrls, mergedConfigured } = buildConfiguredServers(indexedState.byUrl)

    if (!mergedConfigured.length) return

    const currentOrigin = normalizeUrl(d.location.origin)
    const persistedDefaultRaw = d.localStorage.getItem(defaultServerUrlKey) || ""
    const persistedDefault = normalizeUrl(persistedDefaultRaw)
    const nextList: ServerListItem[] = []

    for (let i = 0; i < indexedState.entries.length; i++) {
      const entry = indexedState.entries[i]!
      if (entry.url && configuredUrls[entry.url]) continue
      if (currentOrigin && !configuredUrls[currentOrigin] && entry.url === currentOrigin) continue
      nextList.push(entry.item)
    }

    let effectivePersistedDefault = persistedDefault
    if (currentOrigin && !configuredUrls[currentOrigin] && effectivePersistedDefault === currentOrigin) {
      effectivePersistedDefault = ""
    }

    nextList.unshift(...mergedConfigured)

    const nextState: ServerState = {
      list: nextList,
      projects: state.projects,
      lastProject: state.lastProject,
    }
    const nextStateRaw = JSON.stringify(nextState)
    const bootstrapUrl = mergedConfigured[0]!.http!.url
    const configuredDefault = mergedConfigured[configuredDefaultIndex - 1]
    const fallbackDefaultUrl = configuredDefault?.http?.url ?? ""
    const effectiveDefaultUrl =
      forceDefaultMode !== "force" && effectivePersistedDefault && listHasUrl(nextList, effectivePersistedDefault)
        ? effectivePersistedDefault
        : fallbackDefaultUrl

    if (!effectiveDefaultUrl) return

    d.window.__OPENCODE_SERVER_URL = bootstrapUrl

    if (persisted.raw !== nextStateRaw) {
      d.localStorage.setItem(serverStoreKey, nextStateRaw)
    }

    if (
      persistedDefaultRaw !== effectiveDefaultUrl &&
      (forceDefaultMode === "force" || !persistedDefault || !listHasUrl(nextList, persistedDefault))
    ) {
      d.localStorage.setItem(defaultServerUrlKey, effectiveDefaultUrl)
    }
  } catch (error) {
    d.console.warn("Failed to apply OpenCode runtime config", error)
  }
}
