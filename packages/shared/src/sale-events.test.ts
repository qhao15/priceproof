import { describe, expect, it } from 'vitest';
import { ictTime, SALE_EVENT_SEEDS, saleEventAt } from './sale-events.js';

describe('ictTime', () => {
  it('converts ICT wall-clock time to UTC', () => {
    expect(ictTime(2026, 12, 12).toISOString()).toBe('2026-12-11T17:00:00.000Z');
    expect(ictTime(2026, 1, 1, 7, 30).toISOString()).toBe('2026-01-01T00:30:00.000Z');
  });
});

describe('SALE_EVENT_SEEDS', () => {
  it('has the three 2026 events from the spec, in order and without overlap', () => {
    expect(SALE_EVENT_SEEDS.map((e) => e.id)).toEqual([
      '11-11-2026',
      'black-friday-2026',
      '12-12-2026',
    ]);
    for (let i = 1; i < SALE_EVENT_SEEDS.length; i++) {
      expect(SALE_EVENT_SEEDS[i]!.startsAt.getTime()).toBeGreaterThan(
        SALE_EVENT_SEEDS[i - 1]!.endsAt.getTime(),
      );
    }
  });

  it('covers whole ICT days', () => {
    const bf = SALE_EVENT_SEEDS[1]!;
    expect(bf.startsAt.toISOString()).toBe('2026-11-26T17:00:00.000Z');
    expect(bf.endsAt.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });
});

describe('saleEventAt', () => {
  it('finds the running event', () => {
    expect(saleEventAt(new Date('2026-12-12T03:00:00Z'))?.id).toBe('12-12-2026');
    expect(saleEventAt(new Date('2026-11-30T16:59:59.999Z'))?.id).toBe('black-friday-2026');
    expect(saleEventAt(new Date('2026-11-30T17:00:00Z'))).toBeNull();
  });
});
