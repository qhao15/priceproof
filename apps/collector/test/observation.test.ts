import { SALE_EVENT_SEEDS, type ScrapedItem } from '@priceproof/shared';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type CollectorContext, createContext } from '../src/context.js';
import { initDatabase } from '../src/db/init.js';
import { processObservation } from '../src/processing/observation.js';
import { resetSaleEventCache } from '../src/processing/stats.js';
import { openTestDb, type TestDb } from './mongo.js';

let t: TestDb;
let ctx: CollectorContext;
let now = new Date('2026-11-01T00:00:00Z');
let counter = 0;

function item(overrides: Partial<ScrapedItem> = {}): ScrapedItem {
  return {
    storeProductId: `dm-${counter}`,
    url: `http://localhost:4000/p/item-${counter}`,
    title: 'Điện thoại Novix X5 8GB/128GB - Chính hãng',
    category: 'phone',
    price: 10_090_000,
    listPrice: 12_090_000,
    inStock: true,
    ...overrides,
  };
}

async function observe(i: ScrapedItem, source: 'category' | 'product' = 'category') {
  return processObservation(ctx, { storeId: 'demomart', item: i, source });
}

const later = (days: number) => {
  now = new Date(now.getTime() + days * 86_400_000);
};

async function listing() {
  return (await ctx.col.listings.findOne({ storeProductId: `dm-${counter}` }))!;
}

async function history() {
  const l = await listing();
  return ctx.col.priceChanges.find({ 'meta.listingId': l._id }).sort({ at: 1 }).toArray();
}

beforeAll(async () => {
  t = await openTestDb();
  await initDatabase(t.db, { stores: [], saleEvents: SALE_EVENT_SEEDS });
  ctx = createContext(t.db, pino({ level: 'silent' }), () => now);
  resetSaleEventCache();
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  counter++;
  now = new Date('2026-11-01T00:00:00Z');
});

describe('processObservation (SPEC §9.5)', () => {
  it('first observation: creates product, listing and the first history point', async () => {
    const r = await observe(item());
    expect(r.outcome).toBe('new');
    const l = await listing();
    expect(l.current).toMatchObject({ price: 10_090_000, listPrice: 12_090_000, confirmed: false });
    expect(l.stats.dealLabel).toBe('insufficient_history');
    expect(l.firstSeenAt).toEqual(now);
    expect(l.urlKey).toBe(`localhost:4000/p/item-${counter}`);
    expect(await history()).toHaveLength(1);
    expect(await ctx.col.products.countDocuments({ _id: l.productId, brand: 'novix' })).toBe(1);
  });

  it('unchanged, then confirmed on the second check, without new history', async () => {
    await observe(item());
    later(0.1);
    expect((await observe(item(), 'product')).outcome).toBe('confirmed');
    later(0.1);
    expect((await observe(item())).outcome).toBe('unchanged');
    const l = await listing();
    expect(l.current.confirmed).toBe(true);
    expect(l.current.checkedAt).toEqual(now);
    expect(l.schedule.lastObservedAt).toEqual(now);
    expect(await history()).toHaveLength(1);
  });

  it('price change: new history point, stats and an unconfirmed current price', async () => {
    await observe(item());
    later(10);
    expect((await observe(item({ price: 9_490_000 }))).outcome).toBe('changed');
    const l = await listing();
    expect(l.current).toMatchObject({ price: 9_490_000, confirmed: false, changedAt: now });
    expect(l.current.priceSince).toEqual(now);
    expect(l.stats).toMatchObject({ referencePrice: 10_090_000, realDiscountPct: 5.9 });
    expect(await history()).toHaveLength(2);
  });

  it('list-price-only change: recorded, but priceSince does not move', async () => {
    await observe(item());
    const start = now;
    later(3);
    expect((await observe(item({ listPrice: 14_990_000 }))).outcome).toBe('changed');
    const l = await listing();
    expect(l.current.listPrice).toBe(14_990_000);
    expect(l.current.priceSince).toEqual(start);
    expect(await history()).toHaveLength(2);
  });

  it('suspicious: held, no history and no change to the current price', async () => {
    await observe(item());
    later(1);
    expect((await observe(item({ price: 1_090_000, listPrice: null }))).outcome).toBe('suspicious');
    const l = await listing();
    expect(l.current.price).toBe(10_090_000);
    expect(l.pendingSuspicious).toMatchObject({ price: 1_090_000, seenCount: 1 });
    expect(await history()).toHaveLength(1);
    const hourly = await ctx.col.storeHourlyStats.findOne({
      storeId: 'demomart',
      suspicious: { $gt: 0 },
    });
    expect(hourly).not.toBeNull();
  });

  it('suspicious seen again: counted, still not trusted', async () => {
    await observe(item());
    later(1);
    await observe(item({ price: 31_090_000 }));
    later(0.1);
    expect((await observe(item({ price: 31_090_000 }))).outcome).toBe('suspicious_seen_again');
    const l = await listing();
    expect(l.pendingSuspicious).toMatchObject({ seenCount: 2, lastSeenAt: now });
    expect(l.current.price).toBe(10_090_000);
    expect(await history()).toHaveLength(1);
  });

  it('suspicious resolved by the old price: cleared as a glitch', async () => {
    await observe(item());
    later(0.1);
    await observe(item());
    later(1);
    await observe(item({ price: 1_090_000 }));
    later(0.1);
    expect((await observe(item())).outcome).toBe('unchanged');
    const l = await listing();
    expect(l.pendingSuspicious).toBeNull();
    expect(await history()).toHaveLength(1);
  });

  it('back in stock: both stock changes are trusted history points', async () => {
    await observe(item());
    later(2);
    expect((await observe(item({ inStock: false }))).outcome).toBe('changed');
    expect((await listing()).stats.dealLabel).toBe('out_of_stock');
    later(2);
    expect((await observe(item({ inStock: true }))).outcome).toBe('changed');
    const h = await history();
    expect(h.map((p) => p.inStock)).toEqual([true, false, true]);
  });

  it('"Liên hệ": never creates a listing; on an existing one it counts as out of stock', async () => {
    expect((await observe(item({ price: null, listPrice: null }))).outcome).toBe('no_price');
    expect(await ctx.col.listings.countDocuments({ storeProductId: `dm-${counter}` })).toBe(0);

    await observe(item());
    later(1);
    expect((await observe(item({ price: null, listPrice: null }))).outcome).toBe('changed');
    const l = await listing();
    expect(l.current).toMatchObject({ price: 10_090_000, listPrice: 12_090_000, inStock: false });
  });

  it('reactivates a not-found listing seen again on a category page', async () => {
    await observe(item());
    await ctx.col.listings.updateOne(
      { storeProductId: `dm-${counter}` },
      { $set: { status: 'not_found', 'schedule.notFoundCount': 2 } },
    );
    later(1);
    await observe(item());
    const l = await listing();
    expect(l.status).toBe('active');
    expect(l.schedule.notFoundCount).toBe(0);
  });
});
