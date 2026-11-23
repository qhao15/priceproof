import { gzipSync } from 'node:zlib';
import type { ErrorSnapshotKind } from '@priceproof/shared';
import type { CollectorContext } from '../context.js';
import { ictDayStart } from '../time.js';

/** HTML is capped at 2 MB before gzip; at most 50 snapshots per store per day (SPEC §6.3). */
export const SNAPSHOT_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const SNAPSHOTS_PER_STORE_PER_DAY = 50;

export interface SnapshotInput {
  storeId: string;
  url: string;
  kind: ErrorSnapshotKind;
  httpStatus: number | null;
  message: string;
  html?: string | null;
}

/** Saves an `errorSnapshots` document. Returns false when today's cap is reached. */
export async function saveErrorSnapshot(
  ctx: CollectorContext,
  input: SnapshotInput,
): Promise<boolean> {
  const now = ctx.clock();
  const today = await ctx.col.errorSnapshots.countDocuments({
    storeId: input.storeId,
    createdAt: { $gte: ictDayStart(now) },
  });
  if (today >= SNAPSHOTS_PER_STORE_PER_DAY) return false;
  const html = input.html
    ? Buffer.from(input.html, 'utf8').subarray(0, SNAPSHOT_MAX_HTML_BYTES)
    : null;
  await ctx.col.errorSnapshots.insertOne({
    storeId: input.storeId,
    url: input.url,
    kind: input.kind,
    httpStatus: input.httpStatus,
    message: input.message.slice(0, 1000),
    htmlGzip: html ? gzipSync(html) : null,
    createdAt: now,
  });
  return true;
}
