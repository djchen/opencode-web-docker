import { entrySourcePath } from "./runtime-config.contracts.mjs"
import { every, match } from "./core.mjs"

export const prepareStaticWebSources = {
  entry: entrySourcePath,
  layout: "opencode/packages/app/src/pages/layout.tsx",
  sidebarShell: "opencode/packages/app/src/pages/layout/sidebar-shell.tsx",
  statusPopover: "opencode/packages/app/src/components/status-popover.tsx",
  statusPopoverBody: "opencode/packages/app/src/components/status-popover-body.tsx",
  titlebar: "opencode/packages/app/src/components/titlebar.tsx",
  messageTimeline: "opencode/packages/app/src/pages/session/message-timeline.tsx",
  promptInput: "opencode/packages/app/src/components/prompt-input.tsx",
  dockSurface: "opencode/packages/ui/src/components/dock-surface.tsx",
  iconButton: "opencode/packages/ui/src/components/icon-button.tsx",
  popover: "opencode/packages/ui/src/components/popover.tsx",
  tabs: "opencode/packages/ui/src/components/tabs.tsx",
  tooltip: "opencode/packages/ui/src/components/tooltip.tsx",
}

export const prepareStaticWebContracts = [
  {
    area: "server URL JS patch",
    hint: "If getCurrentUrl() logic changed, update the JS patch in build/prepare-static-web.mjs and the contract; if only regex patterns shifted, update the contract.",
    checks: [
      match(
        "entry",
        /(?:window\.)?location\.hostname\.includes\("opencode\.ai"\)/,
        'expected app getCurrentUrl to keep the opencode.ai hostname check (used by prepare-static-web.mjs JS patch)',
      ),
      match(
        "entry",
        /return "http:\/\/localhost:4096"/,
        'expected app getCurrentUrl to keep returning the localhost bootstrap URL literal (used by prepare-static-web.mjs JS patch)',
      ),
      match(
        "entry",
        /return (?:window\.)?location\.origin/,
        "expected app getCurrentUrl to keep returning location.origin as fallback (used by prepare-static-web.mjs JS patch)",
      ),
    ],
  },
  {
    area: "help-button CSS patch",
    hint: "If sidebar-rail markup or data attributes changed, update the CSS selectors in build/prepare-static-web.mjs; if attributes were just renamed, update both the contract and the patch.",
    checks: [
      match(
        "sidebarShell",
        /data-component="sidebar-rail"/,
        'expected sidebar rail markup to keep data-component="sidebar-rail" (used by prepare-static-web.mjs help-button CSS)',
      ),
      match(
        "sidebarShell",
        /icon="help"/,
        'expected sidebar help action to keep rendering an IconButton with icon="help" (used by prepare-static-web.mjs help-button CSS)',
      ),
      every(
        "iconButton",
        [/data-component="icon-button"/, /data-icon=\{props\.icon\}/],
        'expected IconButton to keep exposing data-component="icon-button" and data-icon={props.icon} (used by prepare-static-web.mjs help-button CSS)',
      ),
      match(
        "tooltip",
        /data-component="tooltip-trigger"/,
        'expected Tooltip trigger to keep data-component="tooltip-trigger" (used by prepare-static-web.mjs help-button CSS)',
      ),
    ],
  },
  {
    area: "mobile header CSS patch",
    hint: "If layout markers or titlebar ids changed, update the CSS selectors in build/prepare-static-web.mjs; if markers were just renamed, update both the contract and the patch.",
    checks: [
      every(
        "layout",
        [/fixed inset-x-0 top-10 bottom-0 z-40/, /data-component="sidebar-nav-mobile"/, /fixed top-10 bottom-0/],
        'expected mobile sidebar overlay/nav to keep the fixed top-10 layout markers used by prepare-static-web.mjs mobile header CSS',
      ),
      every(
        "titlebar",
        [/<header[\s\S]*data-tauri-drag-region/, /id="opencode-titlebar-center"/, /id="opencode-titlebar-left"/, /id="opencode-titlebar-right"/],
        'expected titlebar header to keep data-tauri-drag-region and the opencode titlebar mount ids (used by prepare-static-web.mjs mobile header CSS)',
      ),
      match(
        "titlebar",
        /class="titlebar-icon/,
        'expected titlebar controls to keep the titlebar-icon class (used by prepare-static-web.mjs mobile header CSS)',
      ),
      match(
        "messageTimeline",
        /data-session-title/,
        'expected session timeline to keep data-session-title on the sticky session heading (used by prepare-static-web.mjs mobile header CSS)',
      ),
      every(
        "tabs",
        [/data-slot="tabs-list"/, /data-slot="tabs-trigger-wrapper"/, /data-slot="tabs-trigger"/],
        'expected Tabs to keep exposing data-slot="tabs-list", data-slot="tabs-trigger-wrapper", and data-slot="tabs-trigger" (used by prepare-static-web.mjs mobile header CSS)',
      ),
    ],
  },
  {
    area: "status popover mobile CSS patch",
    hint: "If popover data attributes or width classes changed, update the CSS selectors in build/prepare-static-web.mjs; if attributes were just renamed, update both the contract and the patch.",
    checks: [
      every(
        "statusPopover",
        [/w-\[360px\]/, /max-w-\[calc\(100vw-40px\)\]/],
        'expected status popover content to keep its 360px width markers (used by prepare-static-web.mjs mobile popover CSS)',
      ),
      match(
        "popover",
        /data-component="popover-content"/,
        'expected Popover to keep exposing data-component="popover-content" (used by prepare-static-web.mjs mobile popover CSS)',
      ),
      match(
        "popover",
        /data-slot="popover-body"/,
        'expected Popover to keep exposing data-slot="popover-body" (used by prepare-static-web.mjs mobile popover CSS)',
      ),
      match(
        "statusPopoverBody",
        /w-\[360px\]/,
        'expected status popover body to keep its 360px inner width marker (used by prepare-static-web.mjs mobile popover CSS)',
      ),
    ],
  },
  {
    area: "desktop and mobile footer CSS patch",
    hint: "If prompt-input or dock-surface data attributes changed, update the CSS selectors in build/prepare-static-web.mjs; if attributes were just renamed, update both the contract and the patch.",
    checks: [
      every(
        "promptInput",
        [
          /data-component="prompt-input"/,
          /data-component="prompt-agent-control"/,
          /data-component="prompt-model-control"/,
          /data-component="prompt-variant-control"/,
          /aria-hidden="true"/,
          /class="pointer-events-none absolute inset-x-0 bottom-0"/,
          /data-action="prompt-submit"/,
          /data-action="prompt-attach"/,
          /(?:data-action="prompt-agent"|"data-action": "prompt-agent")/,
          /(?:data-action="prompt-model"|"data-action": "prompt-model")/,
          /(?:data-action="prompt-model-variant"|"data-action": "prompt-model-variant")/,
          /h-7/,
          /text-13-medium/,
          /text-13-regular/,
        ],
        'expected prompt footer controls to keep the prompt markers and utility classes used by prepare-static-web.mjs footer CSS',
      ),
      every(
        "dockSurface",
        [/data-dock-surface="tray"/, /data-dock-attach=\{split\.attach \|\| "none"\}/],
        'expected DockTray to keep data-dock-surface="tray" and data-dock-attach markers (used by prepare-static-web.mjs footer CSS)',
      ),
      every(
        "messageTimeline",
        [
          /data-session-title/,
          /class="h-12 w-full flex items-center justify-between gap-2"/,
          /class="flex items-center gap-1 min-w-0 flex-1 pr-3"/,
          /class="shrink-0 flex items-center gap-3"/,
        ],
        "expected session title markup to keep the direct child layout used by prepare-static-web.mjs mobile header CSS",
      ),
    ],
  },
]

