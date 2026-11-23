import { describe, expect, it } from 'vitest';
import { computeListingStats, type HistoryPoint, round1 } from './engine.js';

/** `MM-DD` in 2026 at 00:00 UTC (SPEC §7.6). */
function d(mmdd: string): Date {
  return new Date(`2026-${mmdd}T00:00:00Z`);
}

function p(mmdd: string, price: number, listPrice: number | null, inStock = true): HistoryPoint {
  return { at: d(mmdd), price, listPrice, inStock };
}

const NOW = new Date('2026-12-12T03:00:00Z');

const CASE_A = [
  p('11-01', 21_000_000, 22_990_000),
  p('12-02', 21_000_000, 25_000_000),
  p('12-12', 20_000_000, 25_000_000),
];

describe('computeListingStats: SPEC §7.6 cases', () => {
  it('A: list price raised before the sale → smaller_than_advertised', () => {
    const r = computeListingStats(CASE_A, NOW);
    expect(r.priceSince).toEqual(d('12-12'));
    expect(r.stats).toMatchObject({
      referencePrice: 21_000_000,
      realDiscountPct: 4.8,
      advertisedDiscountPct: 20,
      historyDays: 41,
      windowCoverageDays: 30,
      dealLabel: 'smaller_than_advertised',
    });
  });

  it('B: price raised before the sale → no_real_discount', () => {
    const r = computeListingStats(
      [
        p('11-01', 18_000_000, null),
        p('12-05', 22_000_000, 22_000_000),
        p('12-12', 20_000_000, 25_000_000),
      ],
      NOW,
    );
    expect(r.stats).toMatchObject({
      referencePrice: 18_000_000,
      realDiscountPct: -11.1,
      advertisedDiscountPct: 20,
      dealLabel: 'no_real_discount',
    });
  });

  it('C: honest discount → real_discount', () => {
    const r = computeListingStats(
      [p('10-01', 30_000_000, 30_000_000), p('12-12', 25_500_000, 30_000_000)],
      NOW,
    );
    expect(r.stats).toMatchObject({
      referencePrice: 30_000_000,
      realDiscountPct: 15,
      advertisedDiscountPct: 15,
      dealLabel: 'real_discount',
    });
  });

  it('D: silent drop without list price → real_discount', () => {
    const r = computeListingStats([p('10-01', 10_000_000, null), p('12-12', 9_000_000, null)], NOW);
    expect(r.stats).toMatchObject({
      realDiscountPct: 10,
      advertisedDiscountPct: 0,
      dealLabel: 'real_discount',
    });
  });

  it('E: four days of history → insufficient_history', () => {
    const r = computeListingStats(
      [p('12-08', 15_000_000, null), p('12-12', 14_000_000, 16_000_000)],
      NOW,
    );
    expect(r.stats.historyDays).toBe(4);
    expect(r.stats.dealLabel).toBe('insufficient_history');
  });

  it('F: out-of-stock segments are ignored for the reference price', () => {
    const r = computeListingStats(
      [
        p('10-15', 20_000_000, null),
        p('11-20', 15_000_000, null, false),
        p('11-25', 20_000_000, null),
        p('12-12', 18_000_000, null),
      ],
      NOW,
    );
    expect(r.stats).toMatchObject({
      referencePrice: 20_000_000,
      realDiscountPct: 10,
      dealLabel: 'real_discount',
    });
  });

  it('G: currently out of stock → out_of_stock', () => {
    const r = computeListingStats(
      [p('11-01', 10_000_000, null), p('12-12', 9_000_000, null, false)],
      NOW,
    );
    expect(r.priceSince).toBeNull();
    expect(r.stats.dealLabel).toBe('out_of_stock');
    expect(r.stats.referencePrice).toBeNull();
  });

  it('H: twenty days of history', () => {
    const r = computeListingStats(
      [p('11-22', 12_000_000, 12_000_000), p('12-12', 10_800_000, 13_500_000)],
      NOW,
    );
    expect(r.stats).toMatchObject({
      historyDays: 20,
      windowCoverageDays: 20,
      referencePrice: 12_000_000,
      realDiscountPct: 10,
      advertisedDiscountPct: 20,
      dealLabel: 'smaller_than_advertised',
    });
  });

  it('I: an advertised 1% counts as 0 → normal_price', () => {
    const r = computeListingStats(
      [p('11-01', 10_000_000, null), p('12-12', 10_190_000, 10_290_000)],
      NOW,
    );
    expect(r.stats).toMatchObject({
      advertisedDiscountPct: 0,
      realDiscountPct: -1.9,
      dealLabel: 'normal_price',
    });
  });

  it('J: a duplicate point changes nothing', () => {
    const duplicated = [...CASE_A, p('12-12', 20_000_000, 25_000_000)];
    expect(computeListingStats(duplicated, NOW)).toEqual(computeListingStats(CASE_A, NOW));
  });

  it('lowest30d, lowest90d and highest90d for case A on 12-13', () => {
    const r = computeListingStats(CASE_A, d('12-13'));
    expect(r.stats.lowest30d).toBe(20_000_000);
    expect(r.stats.lowest90d).toBe(20_000_000);
    expect(r.stats.highest90d).toBe(21_000_000);
  });
});

describe('computeListingStats: other rules', () => {
  it('does not move priceSince on a list-price-only change', () => {
    const r = computeListingStats(
      [
        p('11-01', 9_000_000, null),
        p('11-10', 10_000_000, null),
        p('12-01', 10_000_000, 12_000_000),
      ],
      NOW,
    );
    expect(r.priceSince).toEqual(d('11-10'));
  });

  it('accepts unsorted input', () => {
    expect(computeListingStats([...CASE_A].reverse(), NOW)).toEqual(
      computeListingStats(CASE_A, NOW),
    );
  });

  it('has no reference price for a single point', () => {
    const r = computeListingStats([p('12-12', 20_000_000, null)], NOW);
    expect(r.priceSince).toEqual(d('12-12'));
    expect(r.stats.referencePrice).toBeNull();
    expect(r.stats.dealLabel).toBe('insufficient_history');
    expect(r.stats.lowest30d).toBe(20_000_000);
  });

  it('uses only segments that overlap the 30-day window', () => {
    const r = computeListingStats(
      [p('09-01', 5_000_000, null), p('10-01', 10_000_000, null), p('12-12', 9_000_000, null)],
      NOW,
    );
    // 5.000.000 ended on 10-01, before the window [11-12, 12-12).
    expect(r.stats.referencePrice).toBe(10_000_000);
  });

  it('throws on empty history', () => {
    expect(() => computeListingStats([], NOW)).toThrow(RangeError);
  });

  it('rounds half away from zero', () => {
    expect(round1(4.75)).toBe(4.8);
    expect(round1(-11.11)).toBe(-11.1);
    expect(round1(-0.05)).toBe(-0.1);
  });
});
