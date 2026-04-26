export type SyncStatus = "idle" | "connected" | "error" | "pushing" | "pulling" | "first-sync-pending" | "disabled"

export interface SyncStatusInfo {
  status: SyncStatus
  lastSync: number | null
  url: string
}

export interface ServerHttpInfo {
  url: string
  username?: string
  password?: string
}

export interface ServerListItem {
  type: string
  http?: ServerHttpInfo
  displayName?: string
  url?: string
}

export interface ServerState {
  list: ServerListItem[]
  projects: Record<string, unknown>
  lastProject: Record<string, unknown>
}

export interface BlobSyncConfig {
  readLocalBlob: () => Record<string, string | null>
  applyRemoteBlob: (remote: Record<string, unknown>) => void
  pullRemoteBlob: () => Promise<{ status: number; body: Record<string, unknown> | null }>
  pushRemoteBlob: (blob: Record<string, string | null>) => Promise<void>
  onStatusChange: (status: SyncStatus, ts: number | null, url: string) => void
  onFirstSyncDivergence?: (
    local: Record<string, string | null>,
    remote: Record<string, unknown>,
    resolve: (choice: string) => void,
  ) => void
  lastSyncTime: number | null
  debounceMs: number
  intervalMs: number
  url: string
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
  dateNow?: () => number
}

export interface BlobSyncApi {
  markDirty: () => void
  markDeleted: (key: string) => void
  clearDeleted: (key: string) => void
  pullNow: () => void
  resolveFirstSync: (choice: string) => void
  stop: () => void
}

export interface SyncClientDeps {
  localStorage: Storage
  fetch: typeof globalThis.fetch
  setTimeout: typeof globalThis.setTimeout
  clearTimeout: typeof globalThis.clearTimeout
  setInterval: typeof globalThis.setInterval
  clearInterval: typeof globalThis.clearInterval
  document: Document
  location: Location
  window: Window & typeof globalThis
  MutationObserver: typeof globalThis.MutationObserver
  console: Pick<typeof globalThis.console, "warn" | "log">
  dateNow?: () => number
}

export interface RuntimeConfigDeps {
  localStorage: Storage
  document: Document
  location: Location
  window: Window & typeof globalThis
  console: Pick<typeof globalThis.console, "warn" | "log">
}
