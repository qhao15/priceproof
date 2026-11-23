import {
  checkIntervalMinutes,
  computeListingStats,
  computePriority,
  type EngineResult,
  fromMongoMoney,
  type HistoryPoint,
  isBoostWindow,
  type ListingDoc,
  type ListingStatsDoc,
  type Priority,
  type SaleEventDoc,
  toMongoMoneyOrNull,
} from '@priceproof/shared';
import type { ObjectId } from 'mongodb';
import type { CollectorContext } from '../context.js';

/** Trusted history of a listing, oldest first. */
export async function loadHistory(
  ctx: CollectorContext,
  listingId: ObjectId,
): Promise<HistoryPoint[]> {
  const points = await ctx.col.priceChanges
    .find({ 'meta.listingId': listingId })
    .sort({ at: 1 })
    .toArray();
  return points.map((p) => ({
    at: p.at,
    price: fromMongoMoney(p.price),
    listPrice: p.listPrice === null ? null : fromMongoMoney(p.listPrice),
    inStock: p.inStock,
  }));
}

/** `listing.stats` as stored: money as Int64. */
export function statsToDoc(stats: EngineResult['stats']): ListingStatsDoc {
  return {
    ...stats,
    referencePrice: toMongoMoneyOrNull(stats.referencePrice),
    lowest30d: toMongoMoneyOrNull(stats.lowest30d),
    lowest90d: toMongoMoneyOrNull(stats.lowest90d),
    highest90d: toMongoMoneyOrNull(stats.highest90d),
  };
}

/** Runs the discount engine on a listing's trusted history (falls back to `fallback` if empty). */
export async function computeStatsFor(
  ctx: CollectorContext,
  listingId: ObjectId,
  now: Date,
  fallback?: HistoryPoint,
): Promise<EngineResult> {
  const history = await loadHistory(ctx, listingId);
  if (history.length === 0 && fallback) history.push(fallback);
  return computeListingStats(history, now);
}

let cachedEvents: { at: number; events: SaleEventDoc[] } | null = null;

/** Sale events, cached for a minute (admins can add events through the API). */
export async function saleEvents(ctx: CollectorContext): Promise<SaleEventDoc[]> {
  const now = Date.now();
  if (!cachedEvents || now - cachedEvents.at > 60_000) {
    cachedEvents = { at: now, events: await ctx.col.saleEvents.find().toArray() };
  }
  return cachedEvents.events;
}

/** Clears the sale event cache (tests). */
export function resetSaleEventCache(): void {
  cachedEvents = null;
}

export async function inBoostWindow(ctx: CollectorContext, now: Date): Promise<boolean> {
  return isBoostWindow(now, await saleEvents(ctx));
}

/** Priority of a listing (SPEC §9.4 "Priority rules"). */
export async function priorityFor(
  ctx: CollectorContext,
  listing: Pick<ListingDoc, 'productId' | 'trackedAt'>,
  dealLabel: ListingStatsDoc['dealLabel'] | null,
  changedAt: Date | null,
  now: Date,
): Promise<Priority> {
  const hasWatch =
    (await ctx.col.watches.countDocuments({ productId: listing.productId }, { limit: 1 })) > 0;
  return computePriority({ hasWatch, trackedAt: listing.trackedAt, dealLabel, changedAt, now });
}

export async function nextCheckAt(
  ctx: CollectorContext,
  priority: Priority,
  now: Date,
): Promise<Date> {
  const minutes = checkIntervalMinutes(priority, await inBoostWindow(ctx, now));
  return new Date(now.getTime() + minutes * 60_000);
}
