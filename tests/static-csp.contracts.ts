import { every, match } from "./core"
import type { Contract } from "./core"

const upstreamDefaultCspPattern = /const DEFAULT_CSP\s*=\s*"([^"]+)"/
const staticWebCspPattern = /Content-Security-Policy\s*=\s*"([^"]+)"/

const connectSrcAdditions = ["http:", "https:", "ws:", "wss:"]
const scriptSrcAdditions = ["'unsafe-inline'"]
const extraDirectives: Record<string, string[]> = {
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
}

export const staticCspSources: Record<string, string> = {
  staticWebConfig: "config/sws.toml",
  uiRoutes: "opencode/packages/opencode/src/server/routes/ui.ts",
}

export function extractUpstreamDefaultCsp(source: string): string {
  const cspMatch = source.match(upstreamDefaultCspPattern)
  if (!cspMatch) throw new Error("Could not locate DEFAULT_CSP in upstream ui.ts")
  return cspMatch[1]!
}

export function extractStaticWebCsp(source: string): string {
  const cspMatch = source.match(staticWebCspPattern)
  if (!cspMatch) throw new Error("Could not locate Content-Security-Policy in config/sws.toml")
  return cspMatch[1]!
}

export function parseCsp(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/)
        return [name!, values] as const
      }),
  )
}

function mergeValues(values: string[], additions: string[]): string[] {
  return [...values, ...additions.filter((value) => !values.includes(value))]
}

export function buildExpectedStaticWebCsp(upstreamDefaultCsp: string): Map<string, string[]> {
  const upstream = parseCsp(upstreamDefaultCsp)
  const expected = new Map(upstream.entries())

  expected.set("script-src", mergeValues(expected.get("script-src") ?? [], scriptSrcAdditions))
  expected.set("connect-src", mergeValues(expected.get("connect-src") ?? [], connectSrcAdditions))

  for (const [name, values] of Object.entries(extraDirectives)) {
    if (!expected.has(name)) expected.set(name, values)
  }

  return expected
}

function sameValues(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

export function sameCsp(actual: Map<string, string[]>, expected: Map<string, string[]>): boolean {
  const actualKeys = [...actual.keys()].sort()
  const expectedKeys = [...expected.keys()].sort()

  if (!sameValues(actualKeys, expectedKeys)) return false

  return actualKeys.every((key) => sameValues(actual.get(key) ?? [], expected.get(key) ?? []))
}

export function matchesUpstreamStaticCsp(files: Record<string, string>): boolean {
  return sameCsp(
    parseCsp(extractStaticWebCsp(files["staticWebConfig"]!)),
    buildExpectedStaticWebCsp(extractUpstreamDefaultCsp(files["uiRoutes"]!)),
  )
}

export const staticCspContracts: Contract[] = [
  {
    area: "static-web CSP",
    hint: "If upstream changed its DEFAULT_CSP directives, update config/sws.toml to match (plus the wrapper's additions); if the wrapper's extra directives changed intent, update the contract expectations.",
    checks: [
      {
        file: "staticWebConfig",
        message:
          "expected config/sws.toml CSP to match upstream DEFAULT_CSP, plus this wrapper's extra base-uri/frame-ancestors/object-src directives and broader connect-src for external backends",
        test: matchesUpstreamStaticCsp,
      },
    ],
  },
]