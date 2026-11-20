import { createHash } from 'node:crypto';
import { SALE_EVENT_SEEDS } from '@priceproof/shared';
import { describe, expect, it } from 'vitest';
import {
  DEMO_STORE_IDS,
  getCatalog,
  isContactOnly,
  isOutOfStock,
  priceAt,
  scenarioFor,
} from '../src/index.js';
import { discountAt } from './helpers.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const { products, listingsByStore } = getCatalog();

/** Every (product, store) pair that is sold. */
const pairs = DEMO_STORE_IDS.flatMap((storeId) =>
  [...new Set(listingsByStore[storeId].map((l) => l.productId))].map((productId) => ({
    productId,
    storeId,
  })),
);

function fingerprint(times: Date[]): string {
  const hash = createHash('sha256');
  for (const t of times) {
    for (const { productId, storeId } of pairs) {
      hash.update(JSON.stringify(priceAt(productId, storeId, t)));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

describe('priceAt', () => {
  it('is deterministic: the same input always gives the same output', () => {
    const t = new Date('2026-12-12T03:00:00Z');
    for (const { productId, storeId } of pairs) {
      expect(priceAt(productId, storeId, t)).toEqual(priceAt(productId, storeId, t.getTime()));
    }
    const times = [
      '2026-09-01T00:00:00Z',
      '2026-11-11T05:00:00Z',
      '2026-11-20T12:00:00Z',
      '2026-11-28T03:00:00Z',
      '2026-12-12T03:00:00Z',
      '2027-01-15T00:00:00Z',
    ].map((s) => new Date(s));
    expect(fingerprint(times)).toBe(fingerprint(times));
  });

  it('gives the same prices on every machine (pinned fingerprint)', () => {
    // Changing the catalog, the seed or the price model changes this value on purpose.
    const times = ['2026-11-20T12:00:00Z', '2026-12-12T03:00:00Z'].map((s) => new Date(s));
    expect(fingerprint(times)).toMatchInlineSnapshot(`"e77f2a24977bfa46"`);
  });

  it('shows sane prices: integers ending in 90.000, list price above price', () => {
    for (
      let t = Date.parse('2026-08-01T00:00:00Z');
      t < Date.parse('2027-02-01T00:00:00Z');
      t += 5 * DAY_MS + 7 * HOUR_MS
    ) {
      for (const { productId, storeId } of pairs) {
        const p = priceAt(productId, storeId, t);
        if (p.price === null) {
          expect(p.listPrice).toBeNull();
          continue;
        }
        expect(Number.isSafeInteger(p.price)).toBe(true);
        expect(p.price % 100_000).toBe(90_000);
        if (p.listPrice !== null) {
          expect(p.listPrice).toBeGreaterThan(p.price);
          expect(p.listPrice % 100_000).toBe(90_000);
        }
      }
    }
  });

  it('drifts at most about 3% around the base price, every 3 to 7 days', () => {
    // July–September 2026 has no sale event.
    const from = Date.parse('2026-07-01T00:00:00Z');
    const to = Date.parse('2026-09-30T00:00:00Z');
    for (const { productId, storeId } of pairs) {
      if (isContactOnly(productId, storeId)) continue;
      const base = getCatalog().productById.get(productId)!.basePrice;
      let changes = 0;
      let last: number | null = null;
      for (let t = from; t < to; t += 12 * HOUR_MS) {
        const price = priceAt(productId, storeId, t).price!;
        // store factor (ShopJS ±2–3%) × drift (±3%) + rounding to 100.000
        expect(price).toBeGreaterThanOrEqual(base * 0.98 * 0.97 - 50_000);
        expect(price).toBeLessThanOrEqual(base * 1.03 * 1.03 + 50_000);
        if (last !== null && price !== last) changes++;
        last = price;
      }
      // 91 days with a new drift every 3–7 days: at most ~30 changes (some round to equal).
      expect(changes).toBeLessThanOrEqual(31);
    }
  });

  it('has 1–3 day out-of-stock periods for a few products, never near a sale event', () => {
    // 1 July 2026, 00:00 ICT: outages start and end at ICT midnight.
    const from = Date.parse('2026-06-30T17:00:00Z');
    const to = Date.parse('2027-03-01T00:00:00Z');
    let withOutages = 0;
    for (const { productId, storeId } of pairs) {
      let run = 0;
      let had = false;
      // An outage already running at `from` is cut off, so it is not measured.
      let skipping = isOutOfStock(productId, storeId, from);
      for (let t = from; t < to; t += HOUR_MS) {
        if (isOutOfStock(productId, storeId, t)) {
          if (!skipping) run++;
          had = true;
        } else if (skipping) {
          skipping = false;
        } else if (run > 0) {
          expect(run % 24).toBe(0);
          expect(run / 24).toBeGreaterThanOrEqual(1);
          expect(run / 24).toBeLessThanOrEqual(3);
          run = 0;
        }
      }
      if (had) withOutages++;
      for (const e of SALE_EVENT_SEEDS) {
        expect(isOutOfStock(productId, storeId, e.startsAt.getTime() + HOUR_MS)).toBe(false);
      }
    }
    expect(withOutages).toBeGreaterThan(0);
    expect(withOutages / pairs.length).toBeLessThan(0.3);
  });

  it('shows "Liên hệ" (no price) for contact-only listings', () => {
    const contact = pairs.filter(({ productId, storeId }) => isContactOnly(productId, storeId));
    expect(contact.length).toBeGreaterThan(0);
    for (const { productId, storeId } of contact) {
      expect(priceAt(productId, storeId, Date.now()).price).toBeNull();
    }
  });

  it('rejects products a store does not sell', () => {
    expect(() => priceAt('nope', 'demomart', Date.now())).toThrow(RangeError);
    const notAtShopJs = products.find(
      (p) => !listingsByStore.shopjs.some((l) => l.productId === p.id),
    )!;
    expect(() => priceAt(notAtShopJs.id, 'shopjs', Date.now())).toThrow(RangeError);
  });

  it('keeps the first and last values outside the simulated timeline', () => {
    const { productId, storeId } = pairs[0]!;
    expect(priceAt(productId, storeId, Date.parse('2020-01-01T00:00:00Z'))).toEqual(
      priceAt(productId, storeId, Date.parse('2026-06-01T00:00:00Z')),
    );
    expect(priceAt(productId, storeId, Date.parse('2030-01-01T00:00:00Z')).price).not.toBeNull();
  });
});

describe('sale scenarios, for every event and store', () => {
  for (const event of SALE_EVENT_SEEDS) {
    // Middle of the event's first day (10:00 ICT).
    const during = new Date(event.startsAt.getTime() + 10 * HOUR_MS);

    it(`${event.name}: honest products show a real 8–25% discount, as advertised`, () => {
      let checked = 0;
      for (const { productId, storeId } of pairs) {
        if (scenarioFor(productId, event.id) !== 'honest' || isContactOnly(productId, storeId)) {
          continue;
        }
        const d = discountAt(productId, storeId, during);
        expect(d.realDiscountPct!, productId).toBeGreaterThanOrEqual(8);
        expect(d.realDiscountPct!, productId).toBeLessThan(35);
        expect(d.advertisedDiscountPct - d.realDiscountPct!, productId).toBeLessThan(5);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    });

    it(`${event.name}: inflated products advertise much more than the real discount`, () => {
      let checked = 0;
      for (const { productId, storeId } of pairs) {
        if (scenarioFor(productId, event.id) !== 'inflated' || isContactOnly(productId, storeId)) {
          continue;
        }
        const d = discountAt(productId, storeId, during);
        expect(d.advertisedDiscountPct, productId).toBeGreaterThanOrEqual(15);
        expect(d.realDiscountPct!, productId).toBeLessThanOrEqual(0);
        expect(d.advertisedDiscountPct - d.realDiscountPct!, productId).toBeGreaterThanOrEqual(15);
        // The price went up 10–25% in the ten days before the event.
        const before = priceAt(productId, storeId, event.startsAt.getTime() - 5 * DAY_MS);
        expect(before.price!, productId).toBeGreaterThan(d.price * 1.05);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    });

    it(`${event.name}: silent drops are real discounts without a list price`, () => {
      for (const { productId, storeId } of pairs) {
        if (
          scenarioFor(productId, event.id) !== 'silent_drop' ||
          isContactOnly(productId, storeId)
        ) {
          continue;
        }
        const d = discountAt(productId, storeId, during);
        expect(d.listPrice, productId).toBeNull();
        expect(d.realDiscountPct!, productId).toBeGreaterThanOrEqual(5);
      }
    });

    it(`${event.name}: prices return to normal after the event`, () => {
      const after = event.endsAt.getTime() + DAY_MS;
      for (const { productId, storeId } of pairs) {
        if (isContactOnly(productId, storeId)) continue;
        const base = getCatalog().productById.get(productId)!.basePrice;
        const price = priceAt(productId, storeId, after).price!;
        expect(price, productId).toBeGreaterThanOrEqual(base * 0.98 * 0.97 - 50_000);
        expect(price, productId).toBeLessThanOrEqual(base * 1.03 * 1.03 + 50_000);
      }
    });
  }
});
