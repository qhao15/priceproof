import { describe, expect, it } from 'vitest';
import { SALE_EVENT_SEEDS } from '../sale-events.js';
import {
  checkIntervalMinutes,
  computePriority,
  failureDelayMinutes,
  isBoostWindow,
} from './schedule.js';

const now = new Date('2026-11-20T03:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('isBoostWindow', () => {
  it('runs from 2 days before an event to 2 days after it', () => {
    const twelve = SALE_EVENT_SEEDS[2]!;
    const day = 86_400_000;
    expect(isBoostWindow(new Date(twelve.startsAt.getTime() - 2 * day), SALE_EVENT_SEEDS)).toBe(
      true,
    );
    expect(isBoostWindow(new Date(twelve.startsAt.getTime() - 2 * day - 1), SALE_EVENT_SEEDS)).toBe(
      false,
    );
    expect(isBoostWindow(new Date(twelve.endsAt.getTime() + 2 * day), SALE_EVENT_SEEDS)).toBe(true);
    expect(isBoostWindow(now, SALE_EVENT_SEEDS)).toBe(false);
  });

  it('ignores events without boostCrawl', () => {
    const e = { ...SALE_EVENT_SEEDS[2]!, boostCrawl: false };
    expect(isBoostWindow(e.startsAt, [e])).toBe(false);
  });
});

describe('intervals', () => {
  it('follows the table', () => {
    expect(checkIntervalMinutes(2, false)).toBe(120);
    expect(checkIntervalMinutes(2, true)).toBe(60);
    expect(checkIntervalMinutes(1, false)).toBe(360);
    expect(checkIntervalMinutes(0, true)).toBe(720);
  });

  it('backs off after failures, capped by the interval', () => {
    expect(failureDelayMinutes(1440, 1)).toBe(60);
    expect(failureDelayMinutes(1440, 3)).toBe(240);
    expect(failureDelayMinutes(120, 3)).toBe(120);
  });
});

describe('computePriority', () => {
  const base = { hasWatch: false, trackedAt: null, dealLabel: null, changedAt: null, now };

  it('2 for watched or recently tracked listings', () => {
    expect(computePriority({ ...base, hasWatch: true })).toBe(2);
    expect(computePriority({ ...base, trackedAt: hoursAgo(24 * 7) })).toBe(2);
    expect(computePriority({ ...base, trackedAt: hoursAgo(24 * 7 + 1) })).toBe(0);
  });

  it('1 for deal labels or a change in the last 48 hours', () => {
    expect(computePriority({ ...base, dealLabel: 'real_discount' })).toBe(1);
    expect(computePriority({ ...base, dealLabel: 'no_real_discount' })).toBe(1);
    expect(computePriority({ ...base, dealLabel: 'normal_price' })).toBe(0);
    expect(computePriority({ ...base, changedAt: hoursAgo(48) })).toBe(1);
    expect(computePriority({ ...base, changedAt: hoursAgo(49) })).toBe(0);
  });
});
