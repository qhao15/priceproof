import { SALE_EVENT_SEEDS } from '@priceproof/shared';
import {
  type DemoFault,
  type DemoRequestEvent,
  getTruth,
  startDemoStores,
  stopDemoStores,
} from 'demo-store';
import { pino } from 'pino';
import { type CollectorContext, createContext } from '../src/context.js';
import { initDatabase } from '../src/db/init.js';
import { type CollectorEnv, CollectorEnvSchema } from '../src/env.js';
import { resetSaleEventCache } from '../src/processing/stats.js';
import { Collector, type Timings } from '../src/runtime/collector.js';
import { storeDefinitions } from '../src/stores/definitions.js';
import { createAdapters } from '../src/stores/registry.js';
import { openTestDb, type TestDb } from './mongo.js';

export const silent = pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' });

/** Short job intervals so a once-mode run takes seconds. */
export const FAST_TIMINGS: Partial<Timings> = {
  schedulerMs: 500,
  commandsMs: 500,
  healthMs: 2_000,
  idleExitMs: 3_000,
  drainMs: 5_000,
  lockRenewMs: 1_000,
};

export interface Harness {
  t: TestDb;
  ctx: CollectorContext;
  env: CollectorEnv;
  events: DemoRequestEvent[];
  collector(owner?: string, timings?: Partial<Timings>): Collector;
  /** Restarts the demo stores (for example without a fault). Keeps the database. */
  restartDemoStores(faults: DemoFault[]): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  faults?: DemoFault[];
  /** Stores to keep enabled. Default: both. */
  enabled?: string[];
  /** Requests per minute for the test stores (an admin-owned field; the hard rule caps it at 60). */
  rate?: number;
}

/** Demo stores on random ports + a fresh test database, wired like a real collector run. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const events: DemoRequestEvent[] = [];
  let env: CollectorEnv;

  async function startStores(faults: DemoFault[]) {
    const stores = await startDemoStores({
      demoMartPort: 0,
      shopJsPort: 0,
      fixedNow: '2026-11-20T05:00:00Z',
      faults,
      env: {},
      logger: silent,
      onRequest: (e) => events.push(e),
    });
    env = CollectorEnvSchema.parse({
      MONGODB_URI: 'mongodb://unused',
      DEMOMART_FETCH_URL: stores.demoMartUrl,
      SHOPJS_FETCH_URL: stores.shopJsUrl,
    });
  }

  await startStores(options.faults ?? []);
  const t = await openTestDb();
  await initDatabase(t.db, { stores: storeDefinitions(env!), saleEvents: SALE_EVENT_SEEDS });
  resetSaleEventCache();
  const ctx = createContext(t.db, silent);
  const enabled = options.enabled ?? ['demomart', 'shopjs'];
  await ctx.col.stores.updateMany({ _id: { $nin: enabled } }, { $set: { enabled: false } });
  await ctx.col.stores.updateMany(
    {},
    { $set: { 'rateLimit.requestsPerMinute': options.rate ?? 60 } },
  );

  return {
    t,
    ctx,
    get env() {
      return env;
    },
    events,
    collector(owner = `test-${Math.random()}`, timings = FAST_TIMINGS) {
      return new Collector({
        ctx,
        adapters: createAdapters(env),
        userAgent: env.SCRAPER_USER_AGENT,
        mode: 'once',
        owner,
        timings,
      });
    },
    async restartDemoStores(faults) {
      await stopDemoStores();
      await startStores(faults);
    },
    async close() {
      await stopDemoStores();
      await t.close();
    },
  };
}

/** Listings the collector should create: not used, with a price. */
export function expectedListings(storeId: string): string[] {
  return getTruth()
    .products.filter((p) => !p.used)
    .flatMap((p) => p.listings)
    .filter((l) => l.storeId === storeId && !l.contactOnly)
    .map((l) => l.storeProductId);
}

/** Page requests (not scripts or the ShopJS prices API, which the browser loads with the page). */
export function pageRequests(events: DemoRequestEvent[], storeId: string): DemoRequestEvent[] {
  return events
    .filter((e) => e.storeId === storeId && /^\/(c|p)\/|^\/robots\.txt/.test(e.path))
    .sort((a, b) => a.at - b.at);
}
