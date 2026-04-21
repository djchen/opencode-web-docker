export const customizationCss = `
[data-component="sidebar-rail"] :is([data-component="tooltip-trigger"]:has(> [data-component="icon-button"][data-icon="help"]), [data-component="icon-button"][data-icon="help"]) {
  display: none !important;
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
