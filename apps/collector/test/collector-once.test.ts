import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, expectedListings, type Harness, pageRequests } from './harness.js';

const RATE = 60;
let h: Harness;
let firstRunMs = 0;

beforeAll(async () => {
  h = await createHarness({ rate: RATE });
  const collector = h.collector('run-1');
  const second = h.collector('run-2');
  const started = Date.now();
  const run = collector.runOnce(2);
  // Give the first run time to take the lock, then start a second one at the same time.
  await new Promise((r) => setTimeout(r, 1_500));
  const secondResult = await second.runOnce(1);
  expect(secondResult).toBe('locked');
  await run;
  firstRunMs = Date.now() - started;
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('collector once mode against both demo stores', () => {
  it('creates every priced listing of both stores with a current price and history', async () => {
    for (const storeId of ['demomart', 'shopjs']) {
      const expected = expectedListings(storeId);
      const listings = await h.ctx.col.listings.find({ storeId }).toArray();
      const ids = new Set(listings.map((l) => l.storeProductId));
      const found = expected.filter((id) => ids.has(id)).length;
      expect(found / expected.length, storeId).toBeGreaterThanOrEqual(0.9);
      for (const l of listings) {
        expect(l.current.price).toBeGreaterThan(0);
      }
      const withHistory = await h.ctx.col.priceChanges.distinct('meta.listingId', {
        'meta.storeId': storeId,
      });
      expect(withHistory.length).toBe(listings.length);
    }
  });

  it('never creates listings for used items or duplicates', async () => {
    const all = await h.ctx.col.listings.find().toArray();
    expect(all.some((l) => /like new|máy cũ|trưng bày/i.test(l.title))).toBe(false);
    const keys = all.map((l) => `${l.storeId}:${l.storeProductId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('records finished category runs and hourly request stats', async () => {
    const runs = await h.ctx.col.scrapeRuns.find().toArray();
    expect(runs).toHaveLength(6);
    for (const r of runs) {
      expect(r.outcome).toBe('ok');
      expect(r.pages).toBeGreaterThanOrEqual(2);
      expect(r.skippedUsed + r.itemsSeen).toBeGreaterThan(0);
    }
    const stats = await h.ctx.col.storeHourlyStats.find({ storeId: 'demomart' }).toArray();
    expect(stats.reduce((n, s) => n + (s.requests ?? 0), 0)).toBeGreaterThan(5);
    // Counters that were never incremented are absent from the document.
    expect(stats.reduce((n, s) => n + (s.failures ?? 0) + (s.blocked ?? 0), 0)).toBe(0);
    const stores = await h.ctx.col.stores.find().toArray();
    for (const s of stores) {
      expect(s.health.status).toBe('ok');
      for (const c of s.categories) {
        expect(c.leaseUntil).toBeNull();
        expect(c.nextCrawlAt.getTime()).toBeGreaterThan(Date.now());
      }
    }
  });

  it('exits early when nothing is due, and releases the lock', async () => {
    expect(firstRunMs).toBeLessThan(110_000);
    const state = await h.ctx.col.systemState.findOne({ _id: 'collector' });
    expect(state?.lockOwner).toBeNull();
    expect(state?.lastRunMode).toBe('once');
    expect(state?.lastRunFinishedAt).toBeInstanceOf(Date);
  });

  it('never exceeds the store rate and identifies itself honestly', () => {
    const minGap = 60_000 / RATE;
    for (const storeId of ['demomart', 'shopjs']) {
      const requests = pageRequests(h.events, storeId);
      expect(requests.length).toBeGreaterThan(5);
      // Any k consecutive requests span at least k intervals. Arrival times jitter under
      // load, so allow 300 ms; a burst (several requests close together) still fails.
      for (let i = 0; i < requests.length; i++) {
        for (let k = 1; i + k < requests.length; k++) {
          const span = requests[i + k]!.at - requests[i]!.at;
          expect(span, `${storeId} requests ${i}..${i + k}`).toBeGreaterThanOrEqual(
            k * minGap - 300,
          );
        }
      }
    }
    const agents = new Set(h.events.map((e) => e.userAgent));
    expect([...agents]).toEqual([h.env.SCRAPER_USER_AGENT]);
    expect(h.events.some((e) => e.path.startsWith('/cart'))).toBe(false);
  });

  it('does not change anything on a second run when nothing is due', async () => {
    const before = await h.ctx.col.priceChanges.countDocuments();
    const eventsBefore = pageRequests(h.events, 'demomart').length;
    expect(await h.collector('run-3').runOnce(1)).toBe('started');
    expect(await h.ctx.col.priceChanges.countDocuments()).toBe(before);
    // Only robots.txt is fetched again.
    expect(pageRequests(h.events, 'demomart').length - eventsBefore).toBeLessThanOrEqual(1);
  }, 60_000);
});
