import {
  COLLECTIONS,
  SALE_EVENT_SEEDS,
  type StoreDoc,
  type SystemStateDoc,
  toMongoMoney,
} from '@priceproof/shared';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INDEXES, initDatabase } from '../src/db/init.js';
import { CollectorEnvSchema } from '../src/env.js';
import { storeDefinitions } from '../src/stores/definitions.js';
import { openTestDb, type TestDb } from './mongo.js';

const env = CollectorEnvSchema.parse({ MONGODB_URI: 'mongodb://localhost' });
const stores = storeDefinitions(env);
const now = new Date('2026-11-20T03:00:00Z');
let t: TestDb;

beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('initDatabase', () => {
  it('creates every collection, the time series collection and every index', async () => {
    const report = await initDatabase(t.db, { stores, saleEvents: SALE_EVENT_SEEDS, now });
    expect(report.createdCollections.sort()).toEqual(Object.values(COLLECTIONS).sort());
    expect(report.storesInserted).toEqual(['demomart', 'shopjs']);
    expect(report.saleEventsInserted).toHaveLength(3);

    const info = await t.db.listCollections({ name: COLLECTIONS.priceChanges }).toArray();
    expect(info[0]?.type).toBe('timeseries');

    for (const [name, defs] of Object.entries(INDEXES)) {
      const keys = (await t.db.collection(name).indexes()).map((i) => JSON.stringify(i.key));
      for (const def of defs) {
        expect(keys, name).toContain(JSON.stringify(def.key));
      }
    }
  });

  it('seeds the demo stores, the sale events and the collector lock', async () => {
    const demomart = await t.db
      .collection<StoreDoc>(COLLECTIONS.stores)
      .findOne({ _id: 'demomart' });
    expect(demomart).toMatchObject({
      name: 'DemoMart',
      isDemo: true,
      enabled: true,
      hosts: ['localhost:4000'],
      fetchMethod: 'http',
      rateLimit: { requestsPerMinute: 20 },
      health: { status: 'ok', pausedReason: null },
    });
    expect(demomart!.categories.map((c) => c.key)).toEqual(['phone', 'laptop', 'headphones']);
    expect(demomart!.categories[0]).toMatchObject({
      startUrls: ['http://localhost:4000/c/phone'],
      nextCrawlAt: now,
      leaseUntil: null,
    });
    const shopjs = await t.db.collection<StoreDoc>(COLLECTIONS.stores).findOne({ _id: 'shopjs' });
    expect(shopjs?.fetchMethod).toBe('browser');

    const state = await t.db
      .collection<SystemStateDoc>(COLLECTIONS.systemState)
      .findOne({ _id: 'collector' });
    expect(state?.lockUntil.getTime()).toBe(0);
    expect(await t.db.collection(COLLECTIONS.saleEvents).countDocuments()).toBe(3);
  });

  it('is idempotent and keeps admin-owned fields', async () => {
    const col = t.db.collection<StoreDoc>(COLLECTIONS.stores);
    await col.updateOne(
      { _id: 'demomart', 'categories.key': 'phone' },
      {
        $set: {
          enabled: false,
          'rateLimit.requestsPerMinute': 10,
          'categories.$.crawlEveryMinutes': 999,
          name: 'Renamed by hand',
        },
      },
    );
    const later = new Date('2026-11-21T00:00:00Z');
    const report = await initDatabase(t.db, { stores, saleEvents: SALE_EVENT_SEEDS, now: later });
    expect(report.createdCollections).toEqual([]);
    expect(report.storesInserted).toEqual([]);
    expect(report.storesUpdated).toEqual(['demomart', 'shopjs']);
    expect(report.saleEventsInserted).toEqual([]);

    const demomart = (await col.findOne({ _id: 'demomart' }))!;
    expect(demomart.name).toBe('DemoMart'); // code-owned: restored
    expect(demomart.enabled).toBe(false); // admin-owned: kept
    expect(demomart.rateLimit.requestsPerMinute).toBe(10);
    expect(demomart.categories[0]).toMatchObject({ crawlEveryMinutes: 999, nextCrawlAt: now });
    expect(await t.db.collection(COLLECTIONS.systemState).countDocuments()).toBe(1);
  });

  it('applies validators: money must be Int64', async () => {
    const listings = t.db.collection(COLLECTIONS.listings);
    const doc = (price: unknown) => ({
      storeId: 'demomart',
      storeProductId: `dm-${String(price)}`,
      url: 'http://localhost:4000/p/x',
      urlKey: 'localhost:4000/p/x',
      title: 'x',
      category: 'phone',
      variant: {},
      productId: new ObjectId(),
      status: 'active',
      current: {
        price,
        listPrice: null,
        inStock: true,
        changedAt: now,
        checkedAt: now,
        confirmed: false,
      },
      stats: { dealLabel: 'insufficient_history', computedAt: now },
      schedule: { priority: 0, nextCheckAt: now },
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
    });
    await expect(listings.insertOne(doc(12_990_000))).rejects.toThrow(/validation/i);
    await expect(listings.insertOne(doc(toMongoMoney(12_990_000)))).resolves.toBeTruthy();
    // Reads come back as plain numbers.
    const read = await listings.findOne({ storeProductId: 'dm-12990000' });
    expect(read?.current.price).toBe(12_990_000);
  });

  it('enforces the unique store + store product ID index', async () => {
    const listings = t.db.collection(COLLECTIONS.listings);
    const existing = await listings.findOne({});
    const { _id: _ignored, ...copy } = existing!;
    // Reads return plain numbers, so restore the Int64 the validator requires.
    copy.current = { ...copy.current, price: toMongoMoney(copy.current.price) };
    await expect(listings.insertOne(copy)).rejects.toThrow(/duplicate key/);
  });
});
