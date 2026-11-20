import { EnvValidationError } from '@priceproof/shared';
import { describe, expect, it } from 'vitest';
import { createClock } from './clock.js';
import { parseDemoEnv } from './env.js';

describe('parseDemoEnv', () => {
  it('uses the spec defaults', () => {
    const env = parseDemoEnv({});
    expect(env.DEMO_TIME_SCALE).toBe(1);
    expect(env.DEMO_FIXED_NOW).toBeUndefined();
    expect(env.DEMO_FAULTS).toEqual([]);
  });

  it('parses every variable', () => {
    const env = parseDemoEnv({
      DEMO_TIME_SCALE: '60',
      DEMO_FIXED_NOW: '2026-12-12T03:00:00Z',
      DEMO_FAULTS: 'errors5pct,layoutV2, block429,captcha',
    });
    expect(env.DEMO_TIME_SCALE).toBe(60);
    expect(env.DEMO_FIXED_NOW).toBe('2026-12-12T03:00:00Z');
    expect(env.DEMO_FAULTS).toEqual(['errors5pct', 'layoutV2', 'block429', 'captcha']);
  });

  it('rejects bad values', () => {
    expect(() => parseDemoEnv({ DEMO_FAULTS: 'nope' })).toThrow(EnvValidationError);
    expect(() => parseDemoEnv({ DEMO_TIME_SCALE: '0' })).toThrow(EnvValidationError);
    expect(() => parseDemoEnv({ DEMO_FIXED_NOW: 'yesterday' })).toThrow(EnvValidationError);
  });
});

describe('createClock', () => {
  it('freezes time with fixedNow', () => {
    const clock = createClock({ fixedNow: new Date('2026-12-12T03:00:00Z'), timeScale: 60 });
    expect(clock.now().toISOString()).toBe('2026-12-12T03:00:00.000Z');
  });

  it('runs faster with a time scale, starting from now', () => {
    let real = 1_000_000;
    const clock = createClock({ timeScale: 60, realNow: () => real });
    real += 60_000; // one real minute
    expect(clock.now().getTime()).toBe(1_000_000 + 60 * 60_000); // one simulated hour
  });
});
