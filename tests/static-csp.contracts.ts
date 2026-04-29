import { match } from "./core"
import type { Contract } from "./core"

const upstreamDefaultCspPattern = /const DEFAULT_CSP\s*=\s*"([^"]+)"/
const headerRulePattern =
  /\[\[advanced\.headers\]\]\s*source\s*=\s*"([^"]+)"\s*\[advanced\.headers\.headers\]\s*([\s\S]*?)(?=\n\[\[advanced\.headers\]\]|\s*$)/g
const headerValuePattern = /^([A-Za-z-]+)\s*=\s*"([^"]*)"$/gm
const catchAllSource = "/**"
const assetsSource = "/assets/**"
const noStoreCacheControl = "no-store, no-cache, must-revalidate"
const immutableCacheControl = "public, max-age=31536000, immutable"

export interface StaticWebHeaderRule {
  source: string
  headers: Record<string, string>
}

export function parseStaticWebHeaderRules(source: string): StaticWebHeaderRule[] {
  return [...source.matchAll(headerRulePattern)].map((match) => {
    const headers: Record<string, string> = {}
    for (const header of match[2]!.matchAll(headerValuePattern)) {
      headers[header[1]!] = header[2]!
    }

    return { source: match[1]!, headers }
  })
}

function getHeaderRule(source: string, ruleSource: string): StaticWebHeaderRule | undefined {
  return parseStaticWebHeaderRules(source).find((rule) => rule.source === ruleSource)
}

function headerValueEquals(source: string, ruleSource: string, headerName: string, expected: string): boolean {
  return getHeaderRule(source, ruleSource)?.headers[headerName] === expected
}

function assetsRuleFollowsCatchAll(source: string): boolean {
  const rules = parseStaticWebHeaderRules(source)
  const catchAllIndex = rules.findIndex((rule) => rule.source === catchAllSource)
  const assetsIndex = rules.findIndex((rule) => rule.source === assetsSource)
  return catchAllIndex !== -1 && assetsIndex !== -1 && assetsIndex > catchAllIndex
}

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

function extractUpstreamDefaultCsp(source: string): string {
  const cspMatch = source.match(upstreamDefaultCspPattern)
  if (!cspMatch) throw new Error("Could not locate DEFAULT_CSP in upstream ui.ts")
  return cspMatch[1]!
}

function extractStaticWebCsp(source: string): string {
  const csp = getHeaderRule(source, catchAllSource)?.headers["Content-Security-Policy"]
  if (!csp) throw new Error(`Could not locate Content-Security-Policy for ${catchAllSource} in config/sws.toml`)
  return csp
}

function parseCsp(csp: string): Map<string, string[]> {
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
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  )
}

function sameCsp(actual: Map<string, string[]>, expected: Map<string, string[]>): boolean {
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

function assetsCspMatchesCatchAll(files: Record<string, string>): boolean {
  const staticWebConfig = files["staticWebConfig"]!
  const catchAllCsp = getHeaderRule(staticWebConfig, catchAllSource)?.headers["Content-Security-Policy"]
  const assetsCsp = getHeaderRule(staticWebConfig, assetsSource)?.headers["Content-Security-Policy"]
  return !!catchAllCsp && assetsCsp === catchAllCsp
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
      {
        file: "staticWebConfig",
        message: "expected /assets/** CSP to match the catch-all /** CSP",
        test: assetsCspMatchesCatchAll,
      },
    ],
  },
  {
    area: "SPA fallback headers",
    hint: "If the catch-all header rule is removed, SPA routes like /session will be served without CSP or no-cache headers. Add it back with the same CSP as /index.html and Cache-Control: no-store. The /assets/** rule overrides with long-lived caching for hashed static assets.",
    checks: [
      match(
        "staticWebConfig",
        /source\s*=\s*"\/\*\*"/,
        'expected config/sws.toml to contain a catch-all source = "/**" header rule for SPA fallback routes',
      ),
      {
        file: "staticWebConfig",
        message: `expected catch-all /** header rule to set Cache-Control = "${noStoreCacheControl}"`,
        test: (files) =>
          headerValueEquals(files["staticWebConfig"]!, catchAllSource, "Cache-Control", noStoreCacheControl),
      },
    ],
  },
  {
    area: "hashed asset caching",
    hint: "If the /assets/** rule is removed, hashed static assets will miss long-lived cache headers. Add it back with Cache-Control: public, max-age=31536000, immutable and the same CSP as the catch-all. The /assets/** rule must come after the catch-all /** because static-web-server uses last-match-wins for header rules.",
    checks: [
      match(
        "staticWebConfig",
        /source\s*=\s*"\/assets\/\*\*"/,
        'expected config/sws.toml to contain a source = "/assets/**" header rule for hashed static assets with long-lived caching',
      ),
      {
        file: "staticWebConfig",
        message: `expected /assets/** header rule to set Cache-Control = "${immutableCacheControl}"`,
        test: (files) =>
          headerValueEquals(files["staticWebConfig"]!, assetsSource, "Cache-Control", immutableCacheControl),
      },
      {
        file: "staticWebConfig",
        message:
          "expected config/sws.toml to define the /assets/** header rule after the catch-all /** rule (static-web-server uses last-match-wins)",
        test: (files) => assetsRuleFollowsCatchAll(files["staticWebConfig"]!),
      },
    ],
  },
]
