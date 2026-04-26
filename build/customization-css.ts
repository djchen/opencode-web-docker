export const customizationCss = `
[data-component="sidebar-rail"] :is([data-component="tooltip-trigger"]:has(> [data-component="icon-button"][data-icon="help"]), [data-component="icon-button"][data-icon="help"]) {
  display: none !important;
}

[data-component="opencode-web-sync-btn"] {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 40px !important;
  height: 40px !important;
  border: none !important;
  background: transparent !important;
  color: var(--muted-foreground, #999) !important;
  cursor: pointer !important;
  border-radius: 8px !important;
  padding: 0 !important;
  font-size: 0 !important;
  line-height: 0 !important;
  position: relative !important;
}

[data-component="opencode-web-sync-btn"]:hover {
  background: var(--background-contrast, rgba(255,255,255,0.08)) !important;
}

[data-component="opencode-web-sync-btn"] svg {
  width: 20px !important;
  height: 20px !important;
}

[data-component="opencode-web-sync-panel"] {
  position: absolute !important;
  bottom: 100% !important;
  left: 0 !important;
  transform: none !important;
  margin-bottom: 8px !important;
  background: var(--background-stronger, #1a1a2e) !important;
  border: 1px solid var(--border, #333) !important;
  border-radius: 8px !important;
  padding: 12px !important;
  min-width: 200px !important;
  max-width: 260px !important;
  color: var(--foreground, #fff) !important;
  font-family: system-ui, -apple-system, sans-serif !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  z-index: 9999 !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-status-row"] {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-status-dot"] {
  width: 8px !important;
  height: 8px !important;
  border-radius: 50% !important;
  flex-shrink: 0 !important;
  background: #9ca3af !important;
}

[data-component="opencode-web-sync-panel"][data-status="connected"] [data-component="sync-status-dot"] {
  background: #22c55e !important;
}

[data-component="opencode-web-sync-panel"][data-status="error"] [data-component="sync-status-dot"] {
  background: #eab308 !important;
}

[data-component="opencode-web-sync-panel"][data-status="first-sync-pending"] [data-component="sync-status-dot"] {
  background: #eab308 !important;
}

[data-component="opencode-web-sync-panel"][data-status="disabled"] [data-component="sync-status-dot"] {
  background: #6b7280 !important;
}

[data-component="sync-choice-btn"] {
  width: 100% !important;
  padding: 6px 12px !important;
  border: 1px solid var(--border, #444) !important;
  border-radius: 6px !important;
  background: var(--background, #222) !important;
  color: var(--foreground, #fff) !important;
  cursor: pointer !important;
  font-size: 13px !important;
  margin-bottom: 6px !important;
}

[data-component="sync-choice-btn"]:hover {
  background: var(--background-contrast, rgba(255,255,255,0.08)) !important;
}

[data-component="sync-choice-btn-primary"] {
  width: 100% !important;
  padding: 6px 12px !important;
  border: 1px solid var(--border, #444) !important;
  border-radius: 6px !important;
  background: var(--background-contrast, rgba(255,255,255,0.12)) !important;
  color: var(--foreground, #fff) !important;
  cursor: pointer !important;
  font-size: 13px !important;
  margin-bottom: 6px !important;
}

[data-component="sync-choice-btn-primary"]:hover {
  background: var(--background-contrast, rgba(255,255,255,0.18)) !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-status-label"] {
  flex: 1 !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-time-row"] {
  color: var(--muted-foreground, #999) !important;
  margin-bottom: 8px !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-now-btn"] {
  width: 100% !important;
  padding: 6px 12px !important;
  border: 1px solid var(--border, #444) !important;
  border-radius: 6px !important;
  background: var(--background, #222) !important;
  color: var(--foreground, #fff) !important;
  cursor: pointer !important;
  font-size: 13px !important;
  margin-bottom: 8px !important;
}

[data-component="opencode-web-sync-panel"] [data-component="sync-url-row"] {
  color: var(--muted-foreground, #666) !important;
  font-size: 11px !important;
  word-break: break-all !important;
}

[data-component="sidebar-rail"] [data-component="tooltip-trigger"]:has(> [data-component="opencode-web-sync-btn"]) {
  display: inline-flex !important;
}

@media (max-width: 767px) {
  div:has(> [data-component="prompt-input"]) {
    scroll-padding-bottom: 40px !important;
  }

  [data-component="prompt-input"],
  [data-component="prompt-input"] + div {
    padding-bottom: 40px !important;
  }

  div:has(> [data-component="prompt-input"]) + div[aria-hidden="true"].pointer-events-none.absolute.inset-x-0.bottom-0 {
    height: 40px !important;
  }

  [data-action="prompt-submit"],
  [data-action="prompt-attach"] {
    width: 24px !important;
    height: 24px !important;
    min-width: 24px !important;
    min-height: 24px !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] :is([data-action="prompt-agent"], [data-action="prompt-model"], [data-action="prompt-model-variant"]) {
    min-height: 34px !important;
    line-height: normal !important;
    padding-bottom: 0 !important;
  }

  header[data-tauri-drag-region]:has(#opencode-titlebar-center) {
    height: 32px !important;
    min-height: 32px !important;
  }

  header[data-tauri-drag-region]:has(#opencode-titlebar-center) .titlebar-icon {
    width: 2.25rem !important;
    height: 2rem !important;
  }

  header[data-tauri-drag-region]:has(#opencode-titlebar-center) :is(#opencode-titlebar-left, #opencode-titlebar-right) {
    gap: 0.25rem !important;
  }

  div:has(> nav[data-component="sidebar-nav-mobile"]) > :first-child,
  [data-component="sidebar-nav-mobile"] {
    top: 32px !important;
  }

  [data-component="popover-content"][class*="w-[360px]"] {
    width: min(360px, calc(100vw - 40px)) !important;
  }

  [data-component="popover-content"][class*="w-[360px]"] [data-slot="popover-body"] > [class*="w-[360px]"] {
    width: 100% !important;
  }

  [data-component="tabs"] > [data-slot="tabs-list"] {
    height: 34px !important;
  }

  [data-component="tabs"] > [data-slot="tabs-list"] > [data-slot="tabs-trigger-wrapper"] {
    font-size: 12px !important;
  }

  [data-component="tabs"] > [data-slot="tabs-list"] > [data-slot="tabs-trigger-wrapper"] > [data-slot="tabs-trigger"] {
    padding: 8px 12px !important;
  }

  div:has(> [data-session-title]) {
    --session-title-height: 28px !important;
    --sticky-accordion-top: 36px !important;
  }

  [data-session-title] {
    padding-bottom: 0.375rem !important;
    padding-left: 0.5rem !important;
    padding-right: 0.75rem !important;
    background: linear-gradient(to bottom, var(--background-stronger) 40px, transparent) !important;
  }

  [data-session-title] > :last-child {
    height: 36px !important;
    gap: 0.5rem !important;
  }

  [data-session-title] > :last-child > :first-child {
    padding-right: 0.25rem !important;
  }

  [data-session-title] > :last-child > :last-child {
    gap: 0.5rem !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] {
    height: 38px !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] > div:has([data-component="prompt-agent-control"]) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    gap: 0.375rem !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] :is([data-component="prompt-agent-control"], [data-component="prompt-model-control"], [data-component="prompt-variant-control"]) {
    line-height: 1 !important;
    transform: none !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] :is([data-action="prompt-agent"], [data-action="prompt-model"], [data-action="prompt-model-variant"]) > * {
    transform: translateY(6px) !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] .h-7 {
    height: 38px !important;
  }

  [data-dock-surface="tray"][data-dock-attach="top"] :is(.text-13-medium, .text-13-regular) {
    font-size: 12px !important;
  }
}
`.trim()
