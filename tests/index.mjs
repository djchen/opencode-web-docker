import {
  prepareStaticWebContracts,
  prepareStaticWebSources,
} from "./prepare-static-web.contracts.mjs"
import {
  runtimeConfigContracts,
  runtimeConfigSources,
} from "./runtime-config.contracts.mjs"
import {
  staticCspContracts,
  staticCspSources,
} from "./static-csp.contracts.mjs"

export const sources = {
  ...runtimeConfigSources,
  ...prepareStaticWebSources,
  ...staticCspSources,
}

export const contracts = [...runtimeConfigContracts, ...prepareStaticWebContracts, ...staticCspContracts]
