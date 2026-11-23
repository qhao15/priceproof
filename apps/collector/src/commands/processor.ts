import {
  type CommandDoc,
  fromMongoMoney,
  toMongoMoney,
  toMongoMoneyOrNull,
} from '@priceproof/shared';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { CollectorContext } from '../context.js';
import { evaluateAlerts } from '../processing/alerts.js';
import { computeStatsFor, statsToDoc } from '../processing/stats.js';

/** Commands from the API (SPEC §9.7). TRACK_URL arrives with the API in M5. */
export const COMMAND_LEASE_MS = 10 * 60_000;

class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ListingPayload = z.object({ listingId: z.string().regex(/^[0-9a-f]{24}$/i) });
const StorePayload = z.object({ storeId: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success)
    throw new CommandError('invalid_payload', r.error.issues[0]?.message ?? 'invalid');
  return r.data;
}

export interface CommandHooks {
  /** RESUME_STORE: restart the store's crawler if one is running. */
  onStoreResumed?: (storeId: string) => Promise<void> | void;
  /** RUN_STORE_NOW / RESUME_STORE: let the scheduler pick the work up now. */
  onWorkDue?: () => void;
}

async function handle(
  ctx: CollectorContext,
  cmd: CommandDoc,
  hooks: CommandHooks,
): Promise<Record<string, unknown>> {
  const now = ctx.clock();
  switch (cmd.type) {
    case 'RECHECK_LISTING': {
      const { listingId } = parse(ListingPayload, cmd.payload);
      const r = await ctx.col.listings.updateOne(
        { _id: new ObjectId(listingId) },
        { $set: { 'schedule.nextCheckAt': now, 'schedule.leaseUntil': null, updatedAt: now } },
      );
      if (r.matchedCount === 0) throw new CommandError('not_found', 'Listing not found');
      hooks.onWorkDue?.();
      return { listingId };
    }
    case 'CONFIRM_SUSPICIOUS': {
      const { listingId } = parse(ListingPayload, cmd.payload);
      const listing = await ctx.col.listings.findOne({ _id: new ObjectId(listingId) });
      if (!listing) throw new CommandError('not_found', 'Listing not found');
      const pending = listing.pendingSuspicious;
      if (!pending) throw new CommandError('no_pending_suspicious', 'Nothing to confirm');
      // Reads return plain numbers; money is written back as Int64.
      const price = toMongoMoney(fromMongoMoney(pending.price));
      const listPrice = toMongoMoneyOrNull(
        pending.listPrice === null ? null : fromMongoMoney(pending.listPrice),
      );
      await ctx.col.priceChanges.insertOne({
        at: pending.firstSeenAt,
        meta: { listingId: listing._id, storeId: listing.storeId },
        price,
        listPrice,
        inStock: pending.inStock,
        source: 'admin_confirmed',
      });
      const { priceSince, stats } = await computeStatsFor(ctx, listing._id, now);
      await ctx.col.listings.updateOne(
        { _id: listing._id },
        {
          $set: {
            current: {
              price,
              listPrice,
              inStock: pending.inStock,
              changedAt: pending.firstSeenAt,
              priceSince,
              checkedAt: pending.lastSeenAt,
              confirmed: true,
            },
            pendingSuspicious: null,
            stats: statsToDoc(stats),
            updatedAt: now,
          },
        },
      );
      await evaluateAlerts(ctx, listing._id);
      return { listingId, price: fromMongoMoney(pending.price) };
    }
    case 'REJECT_SUSPICIOUS': {
      const { listingId } = parse(ListingPayload, cmd.payload);
      const r = await ctx.col.listings.updateOne(
        { _id: new ObjectId(listingId) },
        {
          $set: {
            pendingSuspicious: null,
            'schedule.nextCheckAt': now,
            'schedule.leaseUntil': null,
            updatedAt: now,
          },
        },
      );
      if (r.matchedCount === 0) throw new CommandError('not_found', 'Listing not found');
      hooks.onWorkDue?.();
      return { listingId };
    }
    case 'RUN_STORE_NOW': {
      const { storeId } = parse(StorePayload, cmd.payload);
      const r = await ctx.col.stores.updateOne(
        { _id: storeId },
        { $set: { 'categories.$[].nextCrawlAt': now, updatedAt: now } },
      );
      if (r.matchedCount === 0) throw new CommandError('not_found', 'Store not found');
      hooks.onWorkDue?.();
      return { storeId };
    }
    case 'RESUME_STORE': {
      const { storeId } = parse(StorePayload, cmd.payload);
      const r = await ctx.col.stores.updateOne(
        { _id: storeId },
        {
          $set: {
            'health.status': 'ok',
            'health.pausedReason': null,
            'health.pausedAt': null,
            'categories.$[].nextCrawlAt': now,
            'categories.$[].leaseUntil': null,
            updatedAt: now,
          },
        },
      );
      if (r.matchedCount === 0) throw new CommandError('not_found', 'Store not found');
      ctx.logger.info({ storeId }, 'store resumed');
      await hooks.onStoreResumed?.(storeId);
      hooks.onWorkDue?.();
      return { storeId };
    }
    case 'TRACK_URL':
      throw new CommandError('unsupported', 'TRACK_URL is handled from M5');
  }
}

/** Claims and runs pending commands, oldest first. Returns how many were processed. */
export async function processCommands(
  ctx: CollectorContext,
  hooks: CommandHooks = {},
  max = 20,
): Promise<number> {
  let processed = 0;
  while (processed < max) {
    const now = ctx.clock();
    const cmd = await ctx.col.commands.findOneAndUpdate(
      { status: 'pending', type: { $ne: 'TRACK_URL' } },
      {
        $set: {
          status: 'processing',
          startedAt: now,
          leaseUntil: new Date(now.getTime() + COMMAND_LEASE_MS),
        },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
    if (!cmd) break;
    processed++;
    try {
      const result = await handle(ctx, cmd, hooks);
      await ctx.col.commands.updateOne(
        { _id: cmd._id },
        { $set: { status: 'done', result, finishedAt: ctx.clock(), leaseUntil: null } },
      );
    } catch (error) {
      const code = error instanceof CommandError ? error.code : 'internal';
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof CommandError)) {
        ctx.logger.error({ err: error, commandId: cmd._id.toHexString() }, 'command failed');
      }
      await ctx.col.commands.updateOne(
        { _id: cmd._id },
        {
          $set: {
            status: 'failed',
            error: { code, message },
            finishedAt: ctx.clock(),
            leaseUntil: null,
          },
        },
      );
    }
  }
  return processed;
}
