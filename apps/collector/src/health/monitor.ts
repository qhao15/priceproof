import type { PauseReason, StoreDoc, StoreHealthStatus } from '@priceproof/shared';
import type { CollectorContext } from '../context.js';

/** Health thresholds (SPEC §9.6). */
export const MIN_REQUESTS_FOR_FAILURE_RATE = 10;
export const PAUSE_FAILURE_RATE = 0.5;
export const DEGRADED_FAILURE_RATE = 0.2;
export const PAUSE_SUSPICIOUS = 5;

export interface HealthInput {
  requests: number;
  failures: number;
  blocked: number;
  suspicious: number;
  /** Latest finished category run: pages fetched and items seen. */
  latestRun: { pages: number; itemsSeen: number } | null;
}

export type HealthVerdict =
  { status: 'paused'; reason: PauseReason } | { status: Exclude<StoreHealthStatus, 'paused'> };

/** Pure health rules (SPEC §9.6), evaluated in table order. */
export function evaluateHealth(h: HealthInput): HealthVerdict {
  if (h.blocked > 0) return { status: 'paused', reason: 'blocked' };
  const failureRate = h.requests > 0 ? h.failures / h.requests : 0;
  if (h.requests >= MIN_REQUESTS_FOR_FAILURE_RATE && failureRate > PAUSE_FAILURE_RATE) {
    return { status: 'paused', reason: 'high_failure_rate' };
  }
  if (h.latestRun && h.latestRun.pages >= 1 && h.latestRun.itemsSeen === 0) {
    return { status: 'paused', reason: 'zero_items' };
  }
  if (h.suspicious >= PAUSE_SUSPICIOUS)
    return { status: 'paused', reason: 'many_suspicious_prices' };
  if (failureRate >= DEGRADED_FAILURE_RATE) return { status: 'degraded' };
  return { status: 'ok' };
}

/** When the store was last resumed (the latest finished RESUME_STORE command), or null. */
async function lastResumedAt(ctx: CollectorContext, storeId: string): Promise<Date | null> {
  const cmd = await ctx.col.commands.findOne(
    { type: 'RESUME_STORE', 'payload.storeId': storeId, status: 'done' },
    { sort: { finishedAt: -1 } },
  );
  return cmd?.finishedAt ?? null;
}

/**
 * Collects the health input of a store: the last 60 minutes of hourly stats and the latest
 * finished category run. Within 60 minutes after a resume, the hourly buckets still hold the
 * requests that caused the pause, so only runs started after the resume count (the crawler
 * itself still pauses at once on a new block).
 */
export async function healthInput(ctx: CollectorContext, storeId: string): Promise<HealthInput> {
  const now = ctx.clock();
  const windowStart = new Date(now.getTime() - 60 * 60_000);
  const resumedAt = await lastResumedAt(ctx, storeId);
  const recentlyResumed = resumedAt !== null && resumedAt > windowStart;
  // Hourly buckets that overlap the last 60 minutes.
  const from = new Date(windowStart);
  from.setUTCMinutes(0, 0, 0);
  const rows = recentlyResumed
    ? []
    : await ctx.col.storeHourlyStats.find({ storeId, hour: { $gte: from } }).toArray();
  const sum = (k: 'requests' | 'failures' | 'blocked' | 'suspicious') =>
    rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const run = await ctx.col.scrapeRuns.findOne(
    {
      storeId,
      finishedAt: { $ne: null },
      ...(resumedAt ? { startedAt: { $gte: resumedAt } } : {}),
    },
    { sort: { finishedAt: -1 } },
  );
  return {
    requests: sum('requests'),
    failures: sum('failures'),
    blocked: sum('blocked'),
    suspicious: sum('suspicious'),
    latestRun: run ? { pages: run.pages, itemsSeen: run.itemsSeen } : null,
  };
}

/** Called when a store is paused, so the runtime can stop its crawler and drop its queue. */
export type OnPaused = (storeId: string, reason: PauseReason) => Promise<void> | void;

/**
 * Pause procedure (SPEC §9.6): sets the store's health, releases its leases and notifies every
 * admin (in-app, plus email if `emailAlerts`). Does nothing if the store is already paused.
 */
export async function pauseStore(
  ctx: CollectorContext,
  storeId: string,
  reason: PauseReason,
  onPaused?: OnPaused,
): Promise<boolean> {
  const now = ctx.clock();
  const result = await ctx.col.stores.updateOne(
    { _id: storeId, 'health.status': { $ne: 'paused' } },
    {
      $set: {
        'health.status': 'paused',
        'health.pausedReason': reason,
        'health.pausedAt': now,
        'categories.$[].leaseUntil': null,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount === 0) return false;
  ctx.logger.warn({ storeId, reason }, 'store paused');
  await ctx.col.listings.updateMany(
    { storeId, 'schedule.leaseUntil': { $ne: null } },
    { $set: { 'schedule.leaseUntil': null } },
  );
  await onPaused?.(storeId, reason);
  await notifyAdminsPaused(ctx, storeId, now);
  return true;
}

async function notifyAdminsPaused(ctx: CollectorContext, storeId: string, pausedAt: Date) {
  const admins = await ctx.col.users.find({ role: 'ADMIN' }).toArray();
  const docs = admins.flatMap((admin) =>
    (admin.emailAlerts ? (['inapp', 'email'] as const) : (['inapp'] as const)).map((channel) => ({
      userId: admin._id,
      kind: 'admin_store_paused' as const,
      channel,
      watchId: null,
      productId: null,
      listingId: null,
      storeId,
      price: null,
      // Includes the user ID so every admin gets one (owner decision 2026-11-20).
      dedupeKey: `admin:paused:${storeId}:${pausedAt.toISOString()}:${admin._id.toHexString()}:${channel}`,
      status: channel === 'inapp' ? ('sent' as const) : ('pending' as const),
      attempts: 0,
      nextAttemptAt: channel === 'email' ? pausedAt : null,
      leaseUntil: null,
      error: null,
      readAt: null,
      createdAt: pausedAt,
      sentAt: channel === 'inapp' ? pausedAt : null,
    })),
  );
  if (docs.length === 0) return;
  try {
    await ctx.col.notifications.insertMany(docs, { ordered: false });
  } catch (error) {
    // Duplicate keys mean the notification already exists: that is the deduplication.
    if (!(error instanceof Error && /E11000/.test(error.message))) throw error;
  }
}

/**
 * Health monitor job (SPEC §9.6): every 5 minutes, and once at the end of a once-mode run.
 * Paused stores stay paused until RESUME_STORE.
 */
export async function runHealthMonitor(ctx: CollectorContext, onPaused?: OnPaused): Promise<void> {
  const stores = await ctx.col.stores.find({ enabled: true }).toArray();
  for (const store of stores) {
    if (store.health.status === 'paused') continue;
    const verdict = evaluateHealth(await healthInput(ctx, store._id));
    if (verdict.status === 'paused') {
      await pauseStore(ctx, store._id, verdict.reason, onPaused);
    } else if (verdict.status !== store.health.status) {
      await ctx.col.stores.updateOne(
        { _id: store._id, 'health.status': { $ne: 'paused' } },
        { $set: { 'health.status': verdict.status, updatedAt: ctx.clock() } },
      );
    }
  }
}

export function isActiveStore(store: Pick<StoreDoc, 'enabled' | 'health'>): boolean {
  return store.enabled && store.health.status !== 'paused';
}
