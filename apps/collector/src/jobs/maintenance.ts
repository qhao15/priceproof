import { computePriority, fromMongoMoney } from '@priceproof/shared';
import type { CollectorContext } from '../context.js';
import { computeStatsFor, nextCheckAt, statsToDoc } from '../processing/stats.js';
import { ictDate, ictHour } from '../time.js';

/** Daily stats refresh time (SPEC §9.1): 03:00 ICT. */
export const DAILY_REFRESH_HOUR_ICT = 3;

/**
 * Lease sweeper (SPEC §9.1): releases expired listing and category leases, and fails commands
 * whose lease expired with code `timeout`.
 */
export async function sweepLeases(ctx: CollectorContext): Promise<void> {
  const now = ctx.clock();
  await ctx.col.listings.updateMany(
    { 'schedule.leaseUntil': { $lt: now } },
    { $set: { 'schedule.leaseUntil': null } },
  );
  await ctx.col.stores.updateMany(
    { 'categories.leaseUntil': { $lt: now } },
    { $set: { 'categories.$[c].leaseUntil': null } },
    { arrayFilters: [{ 'c.leaseUntil': { $lt: now } }] },
  );
  await ctx.col.commands.updateMany(
    { status: 'processing', leaseUntil: { $lt: now } },
    {
      $set: {
        status: 'failed',
        error: { code: 'timeout', message: 'The command lease expired' },
        finishedAt: now,
        leaseUntil: null,
      },
    },
  );
}

/** Priority sync (SPEC §9.4): recomputes every active listing's priority. */
export async function syncPriorities(ctx: CollectorContext): Promise<number> {
  const now = ctx.clock();
  let changed = 0;
  // One query for every watched product instead of one per listing.
  const watched = new Set(
    (await ctx.col.watches.distinct('productId')).map((id) => id.toHexString()),
  );
  const cursor = ctx.col.listings.find(
    { status: 'active' },
    { projection: { productId: 1, trackedAt: 1, stats: 1, current: 1, schedule: 1 } },
  );
  for await (const l of cursor) {
    const priority = computePriority({
      hasWatch: watched.has(l.productId.toHexString()),
      trackedAt: l.trackedAt,
      dealLabel: l.stats.dealLabel,
      changedAt: l.current.changedAt,
      now,
    });
    if (priority !== l.schedule.priority) {
      // A higher priority brings the next check forward; a lower one never postpones it.
      const next = await nextCheckAt(ctx, priority, now);
      await ctx.col.listings.updateOne(
        { _id: l._id },
        {
          $set: {
            'schedule.priority': priority,
            'schedule.nextCheckAt': next < l.schedule.nextCheckAt ? next : l.schedule.nextCheckAt,
          },
        },
      );
      changed++;
    }
  }
  return changed;
}

/** Recomputes stats of every active listing (old prices leave the windows, SPEC §7.3). */
export async function refreshAllStats(ctx: CollectorContext): Promise<number> {
  const now = ctx.clock();
  let count = 0;
  const cursor = ctx.col.listings.find(
    { status: 'active' },
    { projection: { _id: 1, current: 1 } },
  );
  for await (const l of cursor) {
    const { priceSince, stats } = await computeStatsFor(ctx, l._id, now, {
      at: l.current.changedAt,
      price: fromMongoMoney(l.current.price),
      listPrice: l.current.listPrice === null ? null : fromMongoMoney(l.current.listPrice),
      inStock: l.current.inStock,
    });
    await ctx.col.listings.updateOne(
      { _id: l._id },
      { $set: { stats: statsToDoc(stats), 'current.priceSince': priceSince } },
    );
    count++;
  }
  return count;
}

/**
 * Once mode runs the daily refresh at the end of the first run after 03:00 ICT each day
 * (`systemState.lastStatsRefreshDate`). Returns whether it ran.
 */
export async function refreshStatsIfDue(ctx: CollectorContext): Promise<boolean> {
  const now = ctx.clock();
  if (ictHour(now) < DAILY_REFRESH_HOUR_ICT) return false;
  const today = ictDate(now);
  const claimed = await ctx.col.systemState.updateOne(
    { _id: 'collector', lastStatsRefreshDate: { $ne: today } },
    { $set: { lastStatsRefreshDate: today } },
  );
  if (claimed.modifiedCount === 0) return false;
  const n = await refreshAllStats(ctx);
  ctx.logger.info({ listings: n }, 'daily stats refresh done');
  return true;
}
