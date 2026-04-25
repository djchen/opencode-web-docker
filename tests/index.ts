import {
  prepareStaticWebContracts,
  prepareStaticWebSources,
} from "./prepare-static-web.contracts"
import {
  runtimeConfigContracts,
  runtimeConfigSources,
} from "./runtime-config.contracts"
import {
  staticCspContracts,
  staticCspSources,
} from "./static-csp.contracts"
import type { Contract, Sources } from "./core"

export const sources: Sources = {
  ...runtimeConfigSources,
  ...prepareStaticWebSources,
  ...staticCspSources,
}

export const contracts: Contract[] = [...runtimeConfigContracts, ...prepareStaticWebContracts, ...staticCspContracts]