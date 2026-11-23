import type { DealLabel } from '../discount/config.js';

/** Scheduling rules of the collector (SPEC §9.4). Pure functions. */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const PRIORITIES = [0, 1, 2] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Listing check interval in minutes: [normal, sale boost window]. */
export const CHECK_INTERVAL_MINUTES: Record<Priority, { normal: number; boost: number }> = {
  2: { normal: 120, boost: 60 },
  1: { normal: 360, boost: 180 },
  0: { normal: 1440, boost: 720 },
};

/** A priority-2 listing whose price just changed is rechecked this soon (SPEC §9.5 step 6). */
export const CONFIRM_RECHECK_MINUTES = 15;
/** Category crawl interval during a sale boost window. */
export const BOOST_CRAWL_EVERY_MINUTES = 120;
/** Boost windows run from this long before an event's start to this long after its end. */
export const BOOST_MARGIN_MS = 2 * DAY_MS;
/** Lease on a claimed listing check. */
export const LISTING_LEASE_MS = 15 * MINUTE_MS;
/** Lease on a category crawl. */
export const CATEGORY_LEASE_MS = 2 * HOUR_MS;
/** Base of the failure backoff: 30 min × 2^consecutiveFailures. */
export const FAILURE_BACKOFF_BASE_MINUTES = 30;
/** Not-found count at which a listing is marked `not_found`. */
export const NOT_FOUND_LIMIT = 2;

export interface BoostEvent {
  startsAt: Date;
  endsAt: Date;
  boostCrawl: boolean;
}

/** Whether `now` is inside the sale boost window of an event with `boostCrawl`. */
export function isBoostWindow(now: Date, events: readonly BoostEvent[]): boolean {
  const t = now.getTime();
  return events.some(
    (e) =>
      e.boostCrawl &&
      t >= e.startsAt.getTime() - BOOST_MARGIN_MS &&
      t <= e.endsAt.getTime() + BOOST_MARGIN_MS,
  );
}

export function checkIntervalMinutes(priority: Priority, boost: boolean): number {
  const intervals = CHECK_INTERVAL_MINUTES[priority];
  return boost ? intervals.boost : intervals.normal;
}

/** Delay before retrying a listing after a failed check (SPEC §9.4 "After a failure"). */
export function failureDelayMinutes(intervalMinutes: number, consecutiveFailures: number): number {
  return Math.min(intervalMinutes, FAILURE_BACKOFF_BASE_MINUTES * 2 ** consecutiveFailures);
}

export interface PriorityInput {
  hasWatch: boolean;
  trackedAt: Date | null;
  dealLabel: DealLabel | null;
  changedAt: Date | null;
  now: Date;
}

/** Listing priority (SPEC §9.4 "Priority rules"). */
export function computePriority(input: PriorityInput): Priority {
  const t = input.now.getTime();
  if (input.hasWatch || (input.trackedAt && t - input.trackedAt.getTime() <= 7 * DAY_MS)) {
    return 2;
  }
  const interesting =
    input.dealLabel === 'real_discount' ||
    input.dealLabel === 'smaller_than_advertised' ||
    input.dealLabel === 'no_real_discount';
  if (interesting || (input.changedAt && t - input.changedAt.getTime() <= 48 * HOUR_MS)) {
    return 1;
  }
  return 0;
}
