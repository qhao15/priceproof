import { getTruth } from 'demo-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backfillDemo, evaluateDemoLabels, pickEvent } from '../src/demo/demo-tools.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ enabled: ['demomart'] });
  await h.collector().runOnce(2);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('demo:backfill', () => {
  it('refuses to run unless demo prices follow real time', async () => {
    await expect(backfillDemo(h.ctx, { days: 30, timeScale: 60 })).rejects.toThrow(
      /DEMO_TIME_SCALE=1/,
    );
  });

  it('writes demo_backfill history before each listing was first seen, once', async () => {
    const listings = await h.ctx.col.listings.countDocuments({ storeId: 'demomart' });
    const first = await backfillDemo(h.ctx, { days: 30, timeScale: 1 });
    expect(first.listings).toBe(listings);
    expect(first.points).toBeGreaterThan(listings * 3);

    const l = (await h.ctx.col.listings.findOne({ storeId: 'demomart' }))!;
    const points = await h.ctx.col.priceChanges
      .find({ 'meta.listingId': l._id })
      .sort({ at: 1 })
      .toArray();
    expect(points[0]!.source).toBe('demo_backfill');
    expect(l.firstSeenAt).toEqual(points[0]!.at);
    // historyDays runs to the start of the current price run, not to now.
    expect(l.stats.historyDays).toBeGreaterThanOrEqual(7);
    expect(l.stats.dealLabel).not.toBe('insufficient_history');

    const second = await backfillDemo(h.ctx, { days: 30, timeScale: 1 });
    expect(second).toMatchObject({ listings: 0, points: 0, skipped: listings });
  });
});

describe('demo:eval', () => {
  it('groups computed labels by ground-truth scenario', async () => {
    const truth = getTruth();
    const event = pickEvent(truth, new Date('2026-12-12T03:00:00Z'));
    expect(event.id).toBe('12-12-2026');
    expect(pickEvent(truth, new Date('2026-01-01T00:00:00Z')).id).toBe('11-11-2026');
    expect(() => pickEvent(truth, new Date(), 'nope')).toThrow(/Unknown event/);

    const listings = await h.ctx.col.listings.find({ storeId: 'demomart' }).toArray();
    const { rows, unmatched } = evaluateDemoLabels(
      [
        ...listings.map((l) => ({
          storeId: l.storeId,
          storeProductId: l.storeProductId,
          dealLabel: l.stats.dealLabel,
        })),
        { storeId: 'demomart', storeProductId: 'dm-unknown', dealLabel: 'normal_price' },
      ],
      event.id,
      truth,
    );
    expect(unmatched).toBe(1);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(listings.length);
    expect(rows.map((r) => r.scenario)).toEqual(['honest', 'inflated', 'silent_drop', 'none']);
  });
});
