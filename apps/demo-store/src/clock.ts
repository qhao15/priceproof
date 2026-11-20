export interface DemoClock {
  now(): Date;
}

export interface ClockOptions {
  /** Frozen time. When set, `timeScale` is ignored. */
  fixedNow?: Date | null;
  /** Simulated time runs this many times faster than real time, starting now. Default 1. */
  timeScale?: number;
  /** Real clock, for tests. Default `Date.now`. */
  realNow?: () => number;
}

/** The simulated clock of the demo stores (SPEC §14.5 `DEMO_FIXED_NOW`, `DEMO_TIME_SCALE`). */
export function createClock(options: ClockOptions = {}): DemoClock {
  const { fixedNow, timeScale = 1, realNow = Date.now } = options;
  if (fixedNow) {
    const frozen = fixedNow.getTime();
    return { now: () => new Date(frozen) };
  }
  const origin = realNow();
  return { now: () => new Date(origin + (realNow() - origin) * timeScale) };
}
