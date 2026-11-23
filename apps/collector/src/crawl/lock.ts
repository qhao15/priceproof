import { MongoServerError } from 'mongodb';
import type { CollectorContext } from '../context.js';

/** The collector lock lasts 2 minutes and is renewed every 30 seconds (SPEC §9.1). */
export const LOCK_TTL_MS = 2 * 60 * 1000;
export const LOCK_RENEW_MS = 30 * 1000;

/**
 * Takes or renews the collector lock. Returns false when another collector holds it, so the
 * owner's computer and a GitHub Actions run never crawl at the same time.
 */
export async function acquireLock(ctx: CollectorContext, owner: string): Promise<boolean> {
  const now = ctx.clock();
  try {
    const doc = await ctx.col.systemState.findOneAndUpdate(
      { _id: 'collector', $or: [{ lockUntil: { $lt: now } }, { lockOwner: owner }] },
      { $set: { lockOwner: owner, lockUntil: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc?.lockOwner === owner;
  } catch (error) {
    // The upsert tried to insert a second "collector" document: someone else holds the lock.
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

/** Releases the lock if this process holds it. */
export async function releaseLock(ctx: CollectorContext, owner: string): Promise<void> {
  await ctx.col.systemState.updateOne(
    { _id: 'collector', lockOwner: owner },
    { $set: { lockOwner: null, lockUntil: new Date(0) } },
  );
}
