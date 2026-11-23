import type { ObjectId } from 'mongodb';
import type { CollectorContext } from '../context.js';

/**
 * Alert evaluator (SPEC §9.8). It runs when a listing becomes confirmed and after
 * CONFIRM_SUSPICIOUS. Watches, notifications and email arrive in M7; until then it only logs.
 */
export async function evaluateAlerts(ctx: CollectorContext, listingId: ObjectId): Promise<void> {
  ctx.logger.trace({ listingId: listingId.toHexString() }, 'alert evaluation (M7)');
}
