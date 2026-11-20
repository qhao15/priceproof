/** Offset of Asia/Ho_Chi_Minh (ICT) from UTC. Vietnam has no daylight saving time. */
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The UTC instant of a wall-clock time in Asia/Ho_Chi_Minh. `month` is 1-based. */
export function ictTime(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - ICT_OFFSET_MS);
}

export interface SaleEventSeed {
  /** String slug, used as `saleEvents._id`. */
  id: string;
  name: string;
  /** First instant of the event (00:00 ICT on the first day). */
  startsAt: Date;
  /** Last instant of the event (23:59:59.999 ICT on the last day). */
  endsAt: Date;
  boostCrawl: boolean;
}

function lastMsOfIctDay(year: number, month: number, day: number): Date {
  return new Date(ictTime(year, month, day + 1).getTime() - 1);
}

/**
 * Sale events seeded by `db:init` (SPEC §6.3 `saleEvents`). The demo stores use the same list
 * to plan their sale scenarios, so both always agree on the dates.
 */
export const SALE_EVENT_SEEDS: readonly SaleEventSeed[] = Object.freeze([
  {
    id: '11-11-2026',
    name: '11.11',
    startsAt: ictTime(2026, 11, 11),
    endsAt: lastMsOfIctDay(2026, 11, 11),
    boostCrawl: true,
  },
  {
    id: 'black-friday-2026',
    name: 'Black Friday',
    startsAt: ictTime(2026, 11, 27),
    endsAt: lastMsOfIctDay(2026, 11, 30),
    boostCrawl: true,
  },
  {
    id: '12-12-2026',
    name: '12.12',
    startsAt: ictTime(2026, 12, 12),
    endsAt: lastMsOfIctDay(2026, 12, 12),
    boostCrawl: true,
  },
]);

/** The sale event running at `at`, if any. */
export function saleEventAt(
  at: Date,
  events: readonly SaleEventSeed[] = SALE_EVENT_SEEDS,
): SaleEventSeed | null {
  const t = at.getTime();
  return events.find((e) => t >= e.startsAt.getTime() && t <= e.endsAt.getTime()) ?? null;
}
