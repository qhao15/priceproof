/** Asia/Ho_Chi_Minh helpers. Vietnam has no daylight saving time, so the offset is fixed. */
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The ICT calendar date of `at`, as `yyyy-mm-dd`. */
export function ictDate(at: Date): string {
  return new Date(at.getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 ICT of the day that contains `at`. */
export function ictDayStart(at: Date): Date {
  const shifted = at.getTime() + ICT_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - ICT_OFFSET_MS);
}

/** The ICT hour (0–23) of `at`. */
export function ictHour(at: Date): number {
  return new Date(at.getTime() + ICT_OFFSET_MS).getUTCHours();
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}
