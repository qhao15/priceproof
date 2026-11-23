import {
  computeListingStats,
  CONFIRM_RECHECK_MINUTES,
  fromMongoMoney,
  type ListingDoc,
  type PriceChangeSource,
  type ScrapedItem,
  toMongoMoney,
  toMongoMoneyOrNull,
  urlKey,
} from '@priceproof/shared';
import { type Long, MongoServerError, ObjectId } from 'mongodb';
import type { CollectorContext } from '../context.js';
import { incHourly } from '../health/hourly-stats.js';
import { evaluateAlerts } from './alerts.js';
import { createAutoProduct } from './products.js';
import { computeStatsFor, nextCheckAt, priorityFor, statsToDoc } from './stats.js';

/** Observations below 0.3× or above 3× the current price are held as suspicious (SPEC §9.5). */
export const SUSPICIOUS_LOW = 0.3;
export const SUSPICIOUS_HIGH = 3;

export type ObservationOutcome =
  | 'new'
  | 'no_price'
  | 'unchanged'
  | 'confirmed'
  | 'changed'
  | 'suspicious'
  | 'suspicious_seen_again';

interface Obs {
  price: number;
  listPrice: number | null;
  inStock: boolean;
}

function same(a: Obs, b: Obs): boolean {
  return a.price === b.price && a.listPrice === b.listPrice && a.inStock === b.inStock;
}

function fromDoc(v: {
  price: number | Long;
  listPrice: number | Long | null;
  inStock: boolean;
}): Obs {
  return {
    price: fromMongoMoney(v.price),
    listPrice: v.listPrice === null ? null : fromMongoMoney(v.listPrice),
    inStock: v.inStock,
  };
}

function moneyObs(o: Obs) {
  return {
    price: toMongoMoney(o.price),
    listPrice: toMongoMoneyOrNull(o.listPrice),
    inStock: o.inStock,
  };
}

async function insertPriceChange(
  ctx: CollectorContext,
  listing: Pick<ListingDoc, '_id' | 'storeId'>,
  obs: Obs,
  source: PriceChangeSource,
  at: Date,
): Promise<void> {
  await ctx.col.priceChanges.insertOne({
    at,
    meta: { listingId: listing._id, storeId: listing.storeId },
    ...moneyObs(obs),
    source,
  });
}

async function createListing(
  ctx: CollectorContext,
  storeId: string,
  item: ScrapedItem & { price: number },
  source: PriceChangeSource,
  now: Date,
  tracked: boolean,
): Promise<ListingDoc | null> {
  const productId = await createAutoProduct(ctx, item, now);
  const obs: Obs = { price: item.price, listPrice: item.listPrice, inStock: item.inStock };
  const point = { at: now, ...obs };
  const _id = new ObjectId();
  const trackedAt = tracked ? now : null;
  // The first point: the engine sees one point, so the label is insufficient_history.
  const { priceSince, stats } = computeListingStats([point], now);
  const priority = tracked
    ? 2
    : await priorityFor(ctx, { productId, trackedAt }, stats.dealLabel, now, now);
  const doc: ListingDoc = {
    _id,
    storeId,
    storeProductId: item.storeProductId,
    url: item.url,
    urlKey: urlKey(item.url),
    title: item.title,
    category: item.category,
    variant: item.variant ?? {},
    productId,
    status: 'active',
    trackedAt,
    current: {
      ...moneyObs(obs),
      changedAt: now,
      priceSince,
      checkedAt: now,
      confirmed: false,
    },
    pendingSuspicious: null,
    stats: statsToDoc(stats),
    schedule: {
      priority,
      nextCheckAt: await nextCheckAt(ctx, priority, now),
      leaseUntil: null,
      lastObservedAt: now,
      consecutiveFailures: 0,
      notFoundCount: 0,
    },
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.col.listings.insertOne(doc);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      // Another writer created it first: drop our product and process as an existing listing.
      await ctx.col.products.deleteOne({ _id: productId });
      return null;
    }
    throw error;
  }
  await insertPriceChange(ctx, doc, obs, source, now);
  return doc;
}

export interface ObservationInput {
  storeId: string;
  item: ScrapedItem;
  source: PriceChangeSource;
  /** The listing, when the caller already loaded it (product checks). */
  listing?: ListingDoc | null;
  /** Created by TRACK_URL: priority 2 and `trackedAt = now`. */
  tracked?: boolean;
}

export interface ObservationResult {
  outcome: ObservationOutcome;
  listing: ListingDoc | null;
}

/**
 * Processes one observation of a listing (SPEC §9.5). A price must be seen on two checks before
 * anyone is notified, and suspicious prices never reach history until an admin confirms them.
 */
export async function processObservation(
  ctx: CollectorContext,
  input: ObservationInput,
): Promise<ObservationResult> {
  const now = ctx.clock();
  const { storeId, item, source } = input;
  let listing =
    input.listing ??
    (await ctx.col.listings.findOne({ storeId, storeProductId: item.storeProductId }));

  if (!listing) {
    if (item.price === null) {
      return { outcome: 'no_price', listing: null };
    }
    const created = await createListing(
      ctx,
      storeId,
      { ...item, price: item.price },
      source,
      now,
      input.tracked ?? false,
    );
    await incHourly(ctx, storeId, { observations: 1, changes: created ? 1 : 0 }, now);
    if (created) return { outcome: 'new', listing: created };
    listing = await ctx.col.listings.findOne({ storeId, storeProductId: item.storeProductId });
    if (!listing) throw new Error(`Listing ${storeId}/${item.storeProductId} vanished`);
  } else {
    await incHourly(ctx, storeId, { observations: 1 }, now);
  }

  const current = fromDoc(listing.current);
  const obs: Obs =
    item.price === null
      ? { price: current.price, listPrice: current.listPrice, inStock: false }
      : { price: item.price, listPrice: item.listPrice, inStock: item.inStock };

  // Always: title, variant, lastSeenAt and the schedule (SPEC §9.4 "After an observation").
  const priorityNow = listing.schedule.priority;
  const base: Record<string, unknown> = {
    title: item.title,
    variant: item.variant ?? listing.variant,
    lastSeenAt: now,
    updatedAt: now,
    'schedule.lastObservedAt': now,
    'schedule.nextCheckAt': await nextCheckAt(ctx, priorityNow, now),
    'schedule.leaseUntil': null,
    'schedule.consecutiveFailures': 0,
    'schedule.notFoundCount': 0,
  };
  if (listing.status === 'not_found') base.status = 'active';

  // Step 1: a pending suspicious observation.
  if (listing.pendingSuspicious) {
    const pending = fromDoc(listing.pendingSuspicious);
    if (same(obs, pending)) {
      await ctx.col.listings.updateOne(
        { _id: listing._id },
        {
          $set: {
            ...base,
            'pendingSuspicious.lastSeenAt': now,
            'current.checkedAt': now,
          },
          $inc: { 'pendingSuspicious.seenCount': 1 },
        },
      );
      return { outcome: 'suspicious_seen_again', listing };
    }
    // Same as current (a glitch) or something else: clear it and continue.
    base.pendingSuspicious = null;
  }

  // Step 2: unchanged.
  if (same(obs, current)) {
    const set: Record<string, unknown> = { ...base, 'current.checkedAt': now };
    let outcome: ObservationOutcome = 'unchanged';
    if (!listing.current.confirmed) {
      set['current.confirmed'] = true;
      outcome = 'confirmed';
    }
    await ctx.col.listings.updateOne({ _id: listing._id }, { $set: set });
    if (outcome === 'confirmed') {
      await evaluateAlerts(ctx, listing._id);
    }
    return { outcome, listing };
  }

  // Step 3: suspicious jump.
  if (obs.price < SUSPICIOUS_LOW * current.price || obs.price > SUSPICIOUS_HIGH * current.price) {
    await ctx.col.listings.updateOne(
      { _id: listing._id },
      {
        $set: {
          ...base,
          pendingSuspicious: {
            ...moneyObs(obs),
            firstSeenAt: now,
            lastSeenAt: now,
            seenCount: 1,
          },
        },
      },
    );
    await incHourly(ctx, storeId, { suspicious: 1 }, now);
    return { outcome: 'suspicious', listing };
  }

  // Steps 4–6: a trusted change. The change is written first (no transactions on time series).
  await insertPriceChange(ctx, listing, obs, source, now);
  const { priceSince, stats } = await computeStatsFor(ctx, listing._id, now);
  const priority = await priorityFor(ctx, listing, stats.dealLabel, now, now);
  const next =
    priority === 2
      ? new Date(now.getTime() + CONFIRM_RECHECK_MINUTES * 60_000)
      : await nextCheckAt(ctx, priority, now);
  await ctx.col.listings.updateOne(
    { _id: listing._id },
    {
      $set: {
        ...base,
        current: {
          ...moneyObs(obs),
          changedAt: now,
          priceSince,
          checkedAt: now,
          confirmed: false,
        },
        stats: statsToDoc(stats),
        'schedule.priority': priority,
        'schedule.nextCheckAt': next,
      },
    },
  );
  await incHourly(ctx, storeId, { changes: 1 }, now);
  return { outcome: 'changed', listing };
}
