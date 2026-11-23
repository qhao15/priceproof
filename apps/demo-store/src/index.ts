export {
  COLOR_NAMES_VI,
  type ColorKey,
  DEMO_STORE_IDS,
  DEMO_STORE_NAMES,
  type DemoCatalog,
  type DemoListing,
  type DemoProduct,
  type DemoStoreId,
  getCatalog,
  listingVariant,
} from './catalog.js';
export { type DemoClock, createClock } from './clock.js';
export { DEMO_FAULTS, type DemoEnv, DemoEnvSchema, type DemoFault, parseDemoEnv } from './env.js';
export { DEMO_BANNER_TEXT } from './html.js';
export {
  type DemoPrice,
  isContactOnly,
  isOutOfStock,
  priceAt,
  type Scenario,
  SCENARIOS,
  scenarioFor,
} from './prices.js';
export {
  DEFAULT_DEMOMART_PORT,
  DEFAULT_SHOPJS_PORT,
  type RunningDemoStores,
  startDemoStores,
  type StartDemoStoresOptions,
  stopDemoStores,
} from './server.js';
export type { DemoRequestEvent } from './stores/common.js';
export { SHOPJS_LOADING_TEXT } from './stores/shopjs.js';
export { type DemoTruth, type DemoTruthListing, type DemoTruthProduct, getTruth } from './truth.js';
