import {
  COLLECTIONS,
  type SaleEventDoc,
  type SaleEventSeed,
  type StoreCategory,
  type StoreDoc,
  type SystemStateDoc,
} from '@priceproof/shared';
import type { CreateIndexesOptions, Db, Document, IndexSpecification } from 'mongodb';
import type { StoreDefinition } from '../stores/types.js';
import { VALIDATORS } from './validators.js';

const DAY_S = 24 * 60 * 60;

interface IndexDef {
  key: IndexSpecification;
  options?: CreateIndexesOptions;
}

/** Every index of SPEC §6.3. */
export const INDEXES: Record<string, IndexDef[]> = {
  [COLLECTIONS.products]: [{ key: { category: 1, brand: 1 } }, { key: { 'attrs.modelCodes': 1 } }],
  [COLLECTIONS.listings]: [
    { key: { storeId: 1, storeProductId: 1 }, options: { unique: true } },
    { key: { urlKey: 1 } },
    { key: { productId: 1 } },
    { key: { storeId: 1, 'schedule.nextCheckAt': 1 } },
    { key: { 'stats.dealLabel': 1, category: 1, 'stats.realDiscountPct': -1 } },
    { key: { 'pendingSuspicious.firstSeenAt': 1 }, options: { sparse: true } },
  ],
  [COLLECTIONS.priceChanges]: [{ key: { 'meta.listingId': 1, at: 1 } }],
  [COLLECTIONS.matchCandidates]: [
    { key: { status: 1, score: -1 } },
    { key: { sourceProductId: 1, targetProductId: 1 }, options: { unique: true } },
  ],
  [COLLECTIONS.users]: [{ key: { email: 1 }, options: { unique: true } }],
  [COLLECTIONS.refreshTokens]: [
    { key: { tokenHash: 1 }, options: { unique: true } },
    { key: { userId: 1 } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  [COLLECTIONS.watches]: [
    { key: { userId: 1, productId: 1 }, options: { unique: true } },
    { key: { productId: 1 } },
  ],
  [COLLECTIONS.notifications]: [
    { key: { dedupeKey: 1 }, options: { unique: true } },
    { key: { status: 1, nextAttemptAt: 1 } },
    { key: { userId: 1, channel: 1, createdAt: -1 } },
    { key: { createdAt: 1 }, options: { expireAfterSeconds: 180 * DAY_S } },
  ],
  [COLLECTIONS.commands]: [
    { key: { status: 1, createdAt: 1 } },
    { key: { createdBy: 1, createdAt: -1 } },
    { key: { finishedAt: 1 }, options: { expireAfterSeconds: 30 * DAY_S } },
  ],
  [COLLECTIONS.scrapeRuns]: [
    { key: { storeId: 1, startedAt: -1 } },
    { key: { startedAt: 1 }, options: { expireAfterSeconds: 90 * DAY_S } },
  ],
  [COLLECTIONS.storeHourlyStats]: [
    { key: { storeId: 1, hour: -1 } },
    { key: { hour: 1 }, options: { expireAfterSeconds: 30 * DAY_S } },
  ],
  [COLLECTIONS.errorSnapshots]: [
    { key: { storeId: 1, createdAt: -1 } },
    { key: { createdAt: 1 }, options: { expireAfterSeconds: 7 * DAY_S } },
  ],
};

export interface InitReport {
  createdCollections: string[];
  updatedValidators: string[];
  indexes: number;
  storesInserted: string[];
  storesUpdated: string[];
  saleEventsInserted: string[];
}

export interface InitOptions {
  stores: StoreDefinition[];
  saleEvents: readonly SaleEventSeed[];
  now?: Date;
}

/** Merges code-owned category fields into the stored categories, keeping admin-owned fields. */
export function mergeCategories(
  def: StoreDefinition,
  existing: readonly StoreCategory[],
  now: Date,
): StoreCategory[] {
  return def.categories.map((c) => {
    const old = existing.find((e) => e.key === c.key);
    return old
      ? { ...old, key: c.key, startUrls: c.startUrls }
      : {
          key: c.key,
          startUrls: c.startUrls,
          crawlEveryMinutes: c.crawlEveryMinutes,
          nextCrawlAt: now,
          leaseUntil: null,
        };
  });
}

async function ensureCollections(db: Db, report: InitReport): Promise<void> {
  const existing = new Map(
    (await db.listCollections({}, { nameOnly: false }).toArray()).map((c) => [
      c.name,
      c as Document,
    ]),
  );

  const priceChanges = existing.get(COLLECTIONS.priceChanges);
  if (!priceChanges) {
    await db.createCollection(COLLECTIONS.priceChanges, {
      timeseries: { timeField: 'at', metaField: 'meta', granularity: 'hours' },
    });
    report.createdCollections.push(COLLECTIONS.priceChanges);
  } else if (priceChanges.type !== 'timeseries') {
    throw new Error(
      'priceChanges exists but is not a time series collection; drop it on the dev cluster and rerun db:init',
    );
  }

  for (const name of Object.values(COLLECTIONS)) {
    if (name === COLLECTIONS.priceChanges) continue;
    const validator = VALIDATORS[name];
    const validation = validator
      ? { validator, validationLevel: 'moderate' as const, validationAction: 'error' as const }
      : {};
    if (!existing.has(name)) {
      await db.createCollection(name, validation);
      report.createdCollections.push(name);
    } else if (validator) {
      await db.command({ collMod: name, ...validation });
      report.updatedValidators.push(name);
    }
  }
}

async function ensureIndexes(db: Db, report: InitReport): Promise<void> {
  for (const [name, defs] of Object.entries(INDEXES)) {
    for (const def of defs) {
      await db.collection(name).createIndex(def.key, def.options ?? {});
      report.indexes++;
    }
  }
}

async function seedStores(
  db: Db,
  stores: StoreDefinition[],
  now: Date,
  report: InitReport,
): Promise<void> {
  const col = db.collection<StoreDoc>(COLLECTIONS.stores);
  for (const def of stores) {
    const codeOwned = {
      name: def.name,
      isDemo: def.isDemo,
      hosts: def.hosts,
      baseUrl: def.baseUrl,
      showLinks: def.showLinks,
      fetchMethod: def.fetchMethod,
    };
    const existing = await col.findOne({ _id: def.id });
    if (existing) {
      // Field updates only: admin-owned fields (enabled, rateLimit, crawlEveryMinutes) are kept.
      await col.updateOne(
        { _id: def.id },
        {
          $set: {
            ...codeOwned,
            categories: mergeCategories(def, existing.categories, now),
            updatedAt: now,
          },
        },
      );
      report.storesUpdated.push(def.id);
      continue;
    }
    const result = await col.updateOne(
      { _id: def.id },
      {
        $setOnInsert: {
          ...codeOwned,
          enabled: def.enabledByDefault,
          rateLimit: { requestsPerMinute: def.requestsPerMinute },
          categories: mergeCategories(def, [], now),
          health: { status: 'ok', pausedReason: null, pausedAt: null, lastSuccessAt: null },
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) report.storesInserted.push(def.id);
  }
}

async function seedSaleEvents(
  db: Db,
  events: readonly SaleEventSeed[],
  report: InitReport,
): Promise<void> {
  const col = db.collection<SaleEventDoc>(COLLECTIONS.saleEvents);
  for (const e of events) {
    const result = await col.updateOne(
      { _id: e.id },
      {
        $setOnInsert: {
          name: e.name,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          boostCrawl: e.boostCrawl,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) report.saleEventsInserted.push(e.id);
  }
}

async function seedSystemState(db: Db): Promise<void> {
  await db.collection<SystemStateDoc>(COLLECTIONS.systemState).updateOne(
    { _id: 'collector' },
    {
      $setOnInsert: {
        lockOwner: null,
        lockUntil: new Date(0),
        lastRunMode: null,
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastStatsRefreshDate: null,
      },
    },
    { upsert: true },
  );
}

/**
 * `pnpm db:init` (SPEC §6.1): creates collections (including the `priceChanges` time series),
 * validators and every index, and seeds `stores`, `saleEvents` and `systemState`. Idempotent.
 */
export async function initDatabase(db: Db, options: InitOptions): Promise<InitReport> {
  const now = options.now ?? new Date();
  const report: InitReport = {
    createdCollections: [],
    updatedValidators: [],
    indexes: 0,
    storesInserted: [],
    storesUpdated: [],
    saleEventsInserted: [],
  };
  await ensureCollections(db, report);
  await ensureIndexes(db, report);
  await seedStores(db, options.stores, now, report);
  await seedSaleEvents(db, options.saleEvents, report);
  await seedSystemState(db);
  return report;
}
