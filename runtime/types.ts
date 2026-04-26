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

export interface RuntimeConfigDeps {
  localStorage: Storage
  document: Document
  location: Location
  window: Window & typeof globalThis
  console: Pick<typeof globalThis.console, "warn" | "log">
}
