/** Discount engine constants (SPEC §7.1). */

/** Reference window before the current price started. */
export const WINDOW_DAYS = 30;
/** Less history than this gives `insufficient_history`. */
export const MIN_HISTORY_DAYS = 7;
/** Minimum real discount for `real_discount`. */
export const REAL_MIN_PCT = 5;
/** Advertised minus real, in percentage points, for `smaller_than_advertised`. */
export const GAP_PCT = 5;
/** Advertised discounts below this count as 0. */
export const ADVERTISED_MIN_PCT = 3;

/** Neutral deal labels (SPEC §7.4, §7.5). */
export const DEAL_LABELS = [
  'real_discount',
  'smaller_than_advertised',
  'no_real_discount',
  'normal_price',
  'insufficient_history',
  'out_of_stock',
] as const;
export type DealLabel = (typeof DEAL_LABELS)[number];
