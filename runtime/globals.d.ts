declare global {
  interface Window {
    __OPENCODE_SYNC_STATUS?: import("./types").SyncStatusInfo
    __OPENCODE_SERVER_URL?: string
  }
}

export {}
