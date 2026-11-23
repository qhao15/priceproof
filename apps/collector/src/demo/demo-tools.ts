import {
  DEAL_LABELS,
  type DealLabel,
  type PriceChangeDoc,
  toMongoMoney,
  toMongoMoneyOrNull,
} from '@priceproof/shared';
import { type DemoStoreId, type DemoTruth, getTruth, priceAt, type Scenario } from 'demo-store';
import type { CollectorContext } from '../context.js';
import { computeStatsFor, statsToDoc } from '../processing/stats.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** storeId:storeProductId → truth product ID. */
function truthIndex(truth: DemoTruth): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of truth.products) {
    for (const l of p.listings) index.set(`${l.storeId}:${l.storeProductId}`, p.productId);
  }
  return index;
}

export interface EvalRow {
  scenario: Scenario;
  counts: Record<DealLabel, number>;
  total: number;
}

/** The event `demo:eval` reports on: the given one, else the latest that has started. */
export function pickEvent(
  truth: DemoTruth,
  now: Date,
  eventId?: string,
): DemoTruth['events'][number] {
  if (eventId) {
    const e = truth.events.find((x) => x.id === eventId);
    if (!e)
      throw new Error(
        `Unknown event ${eventId}. Known: ${truth.events.map((x) => x.id).join(', ')}`,
      );
    return e;
  }
  const started = truth.events.filter((e) => new Date(e.startsAt) <= now);
  return started.at(-1) ?? truth.events[0]!;
}

/** Computed labels of demo listings per ground-truth scenario (SPEC §9.11 `demo:eval`). */
export function evaluateDemoLabels(
  listings: { storeId: string; storeProductId: string; dealLabel: DealLabel }[],
  eventId: string,
  truth: DemoTruth = getTruth(),
): { rows: EvalRow[]; unmatched: number } {
  const index = truthIndex(truth);
  const byProduct = new Map(truth.products.map((p) => [p.productId, p]));
  const rows = new Map<Scenario, EvalRow>();
  let unmatched = 0;
  for (const l of listings) {
    const productId = index.get(`${l.storeId}:${l.storeProductId}`);
    const scenario = productId ? byProduct.get(productId)?.scenarios[eventId] : undefined;
    if (!scenario) {
      unmatched++;
      continue;
    }
    const row =
      rows.get(scenario) ??
      ({
        scenario,
        counts: Object.fromEntries(DEAL_LABELS.map((d) => [d, 0])) as Record<DealLabel, number>,
        total: 0,
      } satisfies EvalRow);
    row.counts[l.dealLabel]++;
    row.total++;
    rows.set(scenario, row);
  }
  const order: Scenario[] = ['honest', 'inflated', 'silent_drop', 'none'];
  return { rows: order.flatMap((s) => (rows.has(s) ? [rows.get(s)!] : [])), unmatched };
}

export interface BackfillResult {
  listings: number;
  points: number;
  skipped: number;
}

/**
 * `pnpm demo:backfill --days 90` (SPEC §14.6): writes `priceChanges` (source `demo_backfill`) for
 * demo listings from the same `priceAt` the demo stores use, so the public demo has history from
 * day one. Only demo stores; requires real-time demo prices. Listings already backfilled are
 * skipped, so it is safe to run twice.
 */
export async function backfillDemo(
  ctx: CollectorContext,
  options: { days: number; timeScale: number },
): Promise<BackfillResult> {
  if (options.timeScale !== 1) {
    throw new Error('demo:backfill requires DEMO_TIME_SCALE=1 (demo prices must follow real time)');
  }
  const now = ctx.clock();
  const from = Math.floor((now.getTime() - options.days * DAY_MS) / HOUR_MS) * HOUR_MS;
  const demoStores = await ctx.col.stores.find({ isDemo: true }).project({ _id: 1 }).toArray();
  const storeIds = demoStores.map((s) => s._id as string);
  const index = truthIndex(getTruth());
  const result: BackfillResult = { listings: 0, points: 0, skipped: 0 };

  const cursor = ctx.col.listings.find({ storeId: { $in: storeIds }, status: 'active' });
  for await (const listing of cursor) {
    const productId = index.get(`${listing.storeId}:${listing.storeProductId}`);
    const already = await ctx.col.priceChanges.countDocuments(
      { 'meta.listingId': listing._id, source: 'demo_backfill' },
      { limit: 1 },
    );
    if (!productId || already > 0) {
      result.skipped++;
      continue;
    }
    const points: PriceChangeDoc[] = [];
    let last: string | null = null;
    for (let t = from; t < listing.firstSeenAt.getTime(); t += HOUR_MS) {
      const p = priceAt(productId, listing.storeId as DemoStoreId, t);
      if (p.price === null) continue;
      const key = `${p.price}|${p.listPrice}|${p.inStock}`;
      if (key === last) continue;
      last = key;
      points.push({
        at: new Date(t),
        meta: { listingId: listing._id, storeId: listing.storeId },
        price: toMongoMoney(p.price),
        listPrice: toMongoMoneyOrNull(p.listPrice),
        inStock: p.inStock,
        source: 'demo_backfill',
      });
    }
    if (points.length === 0) {
      result.skipped++;
      continue;
    }
    await ctx.col.priceChanges.insertMany(points);
    const { priceSince, stats } = await computeStatsFor(ctx, listing._id, now);
    await ctx.col.listings.updateOne(
      { _id: listing._id },
      {
        $set: {
          firstSeenAt: points[0]!.at,
          'current.priceSince': priceSince,
          stats: statsToDoc(stats),
          updatedAt: now,
        },
      },
    );
    result.listings++;
    result.points += points.length;
  }
  return result;
}
