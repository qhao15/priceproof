import { ictTime, SALE_EVENT_SEEDS, type SaleEventSeed } from '@priceproof/shared';
import { type DemoStoreId, floor90, getCatalog, round90 } from './catalog.js';
import { between, intBetween, unit } from './random.js';

/**
 * Simulated prices (SPEC §14.3). `priceAt` is a pure function of (product, store, time): every
 * copy of the demo stores shows the same price at the same moment.
 *
 * For each product and store a piecewise-constant timeline is built once:
 * 1. regular prices that drift ±0–3% around the base price every 3–7 days;
 * 2. the sale scenarios of each event, applied in date order, so an event's reference price
 *    (lowest price in the 30 days before it) already includes earlier events.
 * Out-of-stock days and "Liên hệ" are applied on top.
 */

export interface DemoPrice {
  /** VND, or null when the store shows "Liên hệ". */
  price: number | null;
  /** Struck-through list price, or null. Always above `price` when set. */
  listPrice: number | null;
  inStock: boolean;
}

export const SCENARIOS = ['honest', 'inflated', 'silent_drop', 'none'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start and end of the simulated timeline. Outside it, the first or last values hold. */
export const TIMELINE_START = ictTime(2026, 6, 1).getTime();
export const TIMELINE_END = ictTime(2027, 7, 1).getTime();

/** Inflated scenario: prices go up this long before the event starts. */
export const INFLATE_LEAD_MS = 10 * DAY_MS;
/** Reference window of the discount engine (SPEC §7.1 WINDOW_DAYS). */
const REFERENCE_WINDOW_MS = 30 * DAY_MS;

/** Share of products per scenario, for each event. */
const SCENARIO_WEIGHTS: [Scenario, number][] = [
  ['honest', 0.3],
  ['inflated', 0.25],
  ['silent_drop', 0.15],
  ['none', 0.3],
];

/** Products with out-of-stock periods, and the share of 3-week blocks that have one. */
const OOS_PRODUCT_SHARE = 0.15;
const OOS_BLOCK_SHARE = 0.6;
const OOS_BLOCK_DAYS = 21;

/** Products that show a struck-through list price outside sale events. */
const LIST_PRICE_SHARE = 0.6;

interface Segment {
  start: number;
  end: number;
  price: number;
  listPrice: number | null;
}

/** The scenario of a product for a sale event (the same at both stores). */
export function scenarioFor(productId: string, eventId: string): Scenario {
  const product = getCatalog().productById.get(productId);
  if (!product || product.used) {
    return 'none';
  }
  let r = unit('scenario', productId, eventId);
  for (const [scenario, weight] of SCENARIO_WEIGHTS) {
    if (r < weight) {
      return scenario;
    }
    r -= weight;
  }
  return 'none';
}

function regularSegments(productId: string, storeId: DemoStoreId, basePrice: number): Segment[] {
  const storeFactor = storeId === 'demomart' ? 1 : between(0.98, 1.03, 'store-factor', productId);
  const listPrice =
    unit('has-list', productId, storeId) < LIST_PRICE_SHARE
      ? round90(basePrice * storeFactor * between(1.06, 1.15, 'list', productId, storeId))
      : null;
  const segments: Segment[] = [];
  let start = TIMELINE_START;
  for (let k = 0; start < TIMELINE_END; k++) {
    const end = Math.min(
      TIMELINE_END,
      start + intBetween(3, 7, 'drift-days', productId, storeId, k) * DAY_MS,
    );
    const drift = between(-0.03, 0.03, 'drift', productId, storeId, k);
    segments.push({ start, end, price: round90(basePrice * storeFactor * (1 + drift)), listPrice });
    start = end;
  }
  return segments;
}

/** Replaces the timeline in [from, to) with one segment. */
function overlay(
  segments: Segment[],
  from: number,
  to: number,
  price: number,
  listPrice: number | null,
): Segment[] {
  const result: Segment[] = [];
  for (const s of segments) {
    if (s.end <= from || s.start >= to) {
      result.push(s);
      continue;
    }
    if (s.start < from) {
      result.push({ ...s, end: from });
    }
    if (s.end > to) {
      result.push({ ...s, start: to });
    }
  }
  result.push({ start: from, end: to, price, listPrice });
  return result.sort((a, b) => a.start - b.start);
}

function segmentAt(segments: readonly Segment[], t: number): Segment {
  if (t < segments[0]!.start) {
    return segments[0]!;
  }
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.start <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return segments[lo]!;
}

function minPrice(segments: readonly Segment[], from: number, to: number): number {
  let min = Infinity;
  for (const s of segments) {
    if (s.start < to && s.end > from) {
      min = Math.min(min, s.price);
    }
  }
  return min;
}

function applyEvent(
  segments: Segment[],
  event: SaleEventSeed,
  productId: string,
  storeId: DemoStoreId,
): Segment[] {
  const start = event.startsAt.getTime();
  const end = event.endsAt.getTime() + 1;
  const keys = [productId, storeId, event.id] as const;
  switch (scenarioFor(productId, event.id)) {
    case 'none':
      return segments;
    case 'honest': {
      // A real 8–25% cut below the 30-day low, advertised against that low.
      const reference = minPrice(segments, start - REFERENCE_WINDOW_MS, start);
      const price = floor90(reference * (1 - between(0.08, 0.25, 'honest', ...keys)));
      return overlay(segments, start, end, price, reference);
    }
    case 'silent_drop': {
      // A real cut without any advertised discount.
      const reference = minPrice(segments, start - REFERENCE_WINDOW_MS, start);
      const price = floor90(reference * (1 - between(0.06, 0.15, 'silent', ...keys)));
      return overlay(segments, start, end, price, null);
    }
    case 'inflated': {
      // Price and list price go up 10–25% ten days before, then a big advertised discount
      // brings the price back to about where it was.
      const leadStart = start - INFLATE_LEAD_MS;
      const before = segmentAt(segments, leadStart - 1).price;
      const raised = round90(before * (1 + between(0.1, 0.25, 'inflate', ...keys)));
      const raisedList = round90(raised * between(1.04, 1.1, 'inflate-list', ...keys));
      const eventList = round90(raised * between(1.2, 1.4, 'inflate-event-list', ...keys));
      const withLead = overlay(segments, leadStart, start, raised, raisedList);
      return overlay(withLead, start, end, before, eventList);
    }
  }
}

const timelines = new Map<string, readonly Segment[]>();

function timeline(productId: string, storeId: DemoStoreId): readonly Segment[] {
  const key = `${productId}|${storeId}`;
  let segments = timelines.get(key);
  if (!segments) {
    const product = getCatalog().productById.get(productId);
    if (!product) {
      throw new RangeError(`Unknown demo product: ${productId}`);
    }
    let built = regularSegments(productId, storeId, product.basePrice);
    for (const event of SALE_EVENT_SEEDS) {
      built = applyEvent(built, event, productId, storeId);
    }
    segments = built;
    timelines.set(key, segments);
  }
  return segments;
}

/** Whether the product is out of stock at the store at time t (1–3 day periods). */
export function isOutOfStock(productId: string, storeId: DemoStoreId, t: number): boolean {
  if (unit('oos', productId, storeId) >= OOS_PRODUCT_SHARE) {
    return false;
  }
  const clamped = Math.min(Math.max(t, TIMELINE_START), TIMELINE_END - 1);
  const blockMs = OOS_BLOCK_DAYS * DAY_MS;
  const block = Math.floor((clamped - TIMELINE_START) / blockMs);
  if (unit('oos-block', productId, storeId, block) >= OOS_BLOCK_SHARE) {
    return false;
  }
  const from =
    TIMELINE_START +
    block * blockMs +
    intBetween(1, OOS_BLOCK_DAYS - 4, 'oos-day', productId, storeId, block) * DAY_MS;
  const to = from + intBetween(1, 3, 'oos-len', productId, storeId, block) * DAY_MS;
  // Never during a sale event or the run-up to one, so every scenario stays visible.
  const nearEvent = SALE_EVENT_SEEDS.some(
    (e) =>
      from <= e.endsAt.getTime() + DAY_MS && to >= e.startsAt.getTime() - INFLATE_LEAD_MS - DAY_MS,
  );
  return !nearEvent && clamped >= from && clamped < to;
}

let listingIndex: { sold: Set<string>; contactOnly: Set<string> } | undefined;

function index(): { sold: Set<string>; contactOnly: Set<string> } {
  if (!listingIndex) {
    const sold = new Set<string>();
    const contactOnly = new Set<string>();
    for (const l of getCatalog().listings) {
      sold.add(`${l.productId}|${l.storeId}`);
      if (l.contactOnly) {
        contactOnly.add(`${l.productId}|${l.storeId}`);
      }
    }
    listingIndex = { sold, contactOnly };
  }
  return listingIndex;
}

/** Whether the store shows "Liên hệ" instead of a price for this product. */
export function isContactOnly(productId: string, storeId: DemoStoreId): boolean {
  return index().contactOnly.has(`${productId}|${storeId}`);
}

/**
 * The price of a product at a store at time t (SPEC §14.3). Pure: the same input always gives
 * the same output.
 *
 * @throws RangeError when the store does not sell the product.
 */
export function priceAt(productId: string, storeId: DemoStoreId, t: Date | number): DemoPrice {
  if (!index().sold.has(`${productId}|${storeId}`)) {
    throw new RangeError(`${storeId} does not sell ${productId}`);
  }
  const time = typeof t === 'number' ? t : t.getTime();
  const inStock = !isOutOfStock(productId, storeId, time);
  if (isContactOnly(productId, storeId)) {
    return { price: null, listPrice: null, inStock };
  }
  const segment = segmentAt(timeline(productId, storeId), time);
  const listPrice =
    segment.listPrice !== null && segment.listPrice > segment.price ? segment.listPrice : null;
  return { price: segment.price, listPrice, inStock };
}
