import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Spaces requests at least `60 / requestsPerMinute` seconds apart. With one request at a time per
 * store, this is a strict upper bound on the rate in every rolling minute (hard rule).
 */
export class RateGate {
  private last = 0;
  private readonly intervalMs: number;

  /** `previous`: a gate this one replaces (rate change), so its last request still counts. */
  constructor(
    readonly requestsPerMinute: number,
    private readonly now: () => number = Date.now,
    previous?: RateGate,
  ) {
    this.intervalMs = Math.ceil(60_000 / requestsPerMinute);
    this.last = previous?.last ?? 0;
  }

  async wait(): Promise<void> {
    const due = this.last + this.intervalMs - this.now();
    if (due > 0) await sleep(due);
    this.last = this.now();
  }
}
