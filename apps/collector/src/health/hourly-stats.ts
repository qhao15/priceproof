import type { StoreHourlyStatsDoc } from '@priceproof/shared';
import type { CollectorContext } from '../context.js';

export type HourlyCounter = keyof Omit<StoreHourlyStatsDoc, '_id' | 'storeId' | 'hour'>;

/** Start of the UTC hour of `at`. */
export function hourStart(at: Date): Date {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** `<storeId>:<yyyy-mm-ddThh>` (SPEC §6.3 `storeHourlyStats`). */
export function hourlyStatsId(storeId: string, at: Date): string {
  return `${storeId}:${hourStart(at).toISOString().slice(0, 13)}`;
}

/** Increments counters in `storeHourlyStats` (upsert with `$inc`). */
export async function incHourly(
  ctx: CollectorContext,
  storeId: string,
  counters: Partial<Record<HourlyCounter, number>>,
  at: Date = ctx.clock(),
): Promise<void> {
  const inc = Object.fromEntries(Object.entries(counters).filter(([, n]) => n !== 0));
  if (Object.keys(inc).length === 0) return;
  await ctx.col.storeHourlyStats.updateOne(
    { _id: hourlyStatsId(storeId, at) },
    { $inc: inc, $setOnInsert: { storeId, hour: hourStart(at) } },
    { upsert: true },
  );
}
