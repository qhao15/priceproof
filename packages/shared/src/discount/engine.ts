import {
  ADVERTISED_MIN_PCT,
  type DealLabel,
  GAP_PCT,
  MIN_HISTORY_DAYS,
  REAL_MIN_PCT,
  WINDOW_DAYS,
} from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One trusted history point of a listing (a `priceChanges` document). */
export interface HistoryPoint {
  at: Date;
  price: number;
  listPrice: number | null;
  inStock: boolean;
}

/** Every field of `listing.stats` (SPEC §6.3). */
export interface ListingStats {
  referencePrice: number | null;
  realDiscountPct: number | null;
  advertisedDiscountPct: number;
  dealLabel: DealLabel;
  historyDays: number;
  windowCoverageDays: number;
  lowest30d: number | null;
  lowest90d: number | null;
  highest90d: number | null;
  computedAt: Date;
}

export interface EngineResult {
  /** Start of the current price run, or null when the listing is out of stock. */
  priceSince: Date | null;
  stats: ListingStats;
}

interface Segment {
  start: number;
  end: number;
  price: number;
  inStock: boolean;
}

/** Rounds to one decimal, half away from zero. */
export function round1(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10;
}

function sameValues(a: HistoryPoint, b: HistoryPoint): boolean {
  return a.price === b.price && a.listPrice === b.listPrice && a.inStock === b.inStock;
}

/** Sorts by time and merges consecutive points with identical values (SPEC §7.2). */
export function normalizeHistory(points: readonly HistoryPoint[]): HistoryPoint[] {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const merged: HistoryPoint[] = [];
  for (const p of sorted) {
    const last = merged.at(-1);
    if (!last || !sameValues(last, p)) {
      merged.push(p);
    }
  }
  return merged;
}

function toSegments(points: readonly HistoryPoint[], now: number): Segment[] {
  return points.map((p, i) => ({
    start: p.at.getTime(),
    end: i + 1 < points.length ? points[i + 1]!.at.getTime() : Math.max(now, p.at.getTime()),
    price: p.price,
    inStock: p.inStock,
  }));
}

/** Min or max price over in-stock segments that overlap [from, to). Null when there are none. */
function extremePrice(
  segments: readonly Segment[],
  from: number,
  to: number,
  pick: (a: number, b: number) => number,
  inclusiveEnd = false,
): number | null {
  let result: number | null = null;
  for (const s of segments) {
    const overlaps = (inclusiveEnd ? s.start <= to : s.start < to) && s.end > from;
    if (s.inStock && overlaps) {
      result = result === null ? s.price : pick(result, s.price);
    }
  }
  return result;
}

export function advertisedDiscountPct(price: number, listPrice: number | null): number {
  if (listPrice === null || listPrice <= price) {
    return 0;
  }
  const pct = round1(((listPrice - price) / listPrice) * 100);
  return pct < ADVERTISED_MIN_PCT ? 0 : pct;
}

export function dealLabelFor(input: {
  inStock: boolean;
  historyDays: number;
  referencePrice: number | null;
  realDiscountPct: number | null;
  advertisedDiscountPct: number;
}): DealLabel {
  if (!input.inStock) return 'out_of_stock';
  if (input.historyDays < MIN_HISTORY_DAYS || input.referencePrice === null) {
    return 'insufficient_history';
  }
  const real = input.realDiscountPct!;
  const advertised = input.advertisedDiscountPct;
  if (advertised > 0 && real <= 0) return 'no_real_discount';
  if (advertised > 0 && advertised - real >= GAP_PCT) return 'smaller_than_advertised';
  if (real >= REAL_MIN_PCT) return 'real_discount';
  return 'normal_price';
}

/**
 * The discount engine (SPEC §7): computes `priceSince` and every field of `listing.stats` from a
 * listing's trusted history. Pure; tolerates unsorted input and duplicate points.
 *
 * @throws RangeError when `points` is empty.
 */
export function computeListingStats(points: readonly HistoryPoint[], now: Date): EngineResult {
  const history = normalizeHistory(points);
  if (history.length === 0) {
    throw new RangeError('computeListingStats needs at least one history point');
  }
  const t = now.getTime();
  const current = history.at(-1)!;
  const firstSeenAt = history[0]!.at.getTime();
  const segments = toSegments(history, t);

  // priceSince: earliest k such that every point from k on has the current price and is in stock.
  let priceSince: number | null = null;
  if (current.inStock) {
    let k = history.length - 1;
    while (k > 0 && history[k - 1]!.inStock && history[k - 1]!.price === current.price) {
      k--;
    }
    priceSince = history[k]!.at.getTime();
  }

  const anchor = priceSince ?? t;
  const historyDays = Math.max(0, Math.floor((anchor - firstSeenAt) / DAY_MS));
  const referencePrice =
    priceSince === null
      ? null
      : extremePrice(segments, priceSince - WINDOW_DAYS * DAY_MS, priceSince, Math.min);
  const realDiscountPct =
    referencePrice === null
      ? null
      : round1(((referencePrice - current.price) / referencePrice) * 100);
  const advertised = advertisedDiscountPct(current.price, current.listPrice);
  const window = (days: number, pick: (a: number, b: number) => number) =>
    extremePrice(segments, t - days * DAY_MS, t, pick, true);

  return {
    priceSince: priceSince === null ? null : new Date(priceSince),
    stats: {
      referencePrice,
      realDiscountPct,
      advertisedDiscountPct: advertised,
      dealLabel: dealLabelFor({
        inStock: current.inStock,
        historyDays,
        referencePrice,
        realDiscountPct,
        advertisedDiscountPct: advertised,
      }),
      historyDays,
      windowCoverageDays: Math.min(WINDOW_DAYS, historyDays),
      lowest30d: window(30, Math.min),
      lowest90d: window(90, Math.min),
      highest90d: window(90, Math.max),
      computedAt: now,
    },
  };
}
