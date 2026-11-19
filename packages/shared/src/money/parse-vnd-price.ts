/** Smallest and largest prices accepted by {@link parseVndPrice}, in VND. */
export const MIN_VND_PRICE = 1_000;
export const MAX_VND_PRICE = 2_000_000_000;

const NUMBER_GROUP = /\d+(?:[.,]\d+)*/g;

/**
 * Parses a Vietnamese price text such as "12.990.000₫" into integer VND (SPEC §18.2).
 *
 * - The text must contain exactly one number group; ranges ("12.990.000₫ - 13.990.000₫") give null.
 * - "." and "," are thousands separators, so every group after the first must have 3 digits
 *   ("12.99" gives null rather than a guess).
 * - The result must be an integer from 1.000 to 2.000.000.000, otherwise null.
 * - "Liên hệ" (no price) and empty text give null.
 */
export function parseVndPrice(text: string | null | undefined): number | null {
  if (!text) {
    return null;
  }
  const groups = text.match(NUMBER_GROUP);
  if (!groups || groups.length !== 1) {
    return null;
  }
  const [first, ...rest] = groups[0]!.split(/[.,]/);
  if (rest.length > 0 && (first!.length > 3 || rest.some((part) => part.length !== 3))) {
    return null;
  }
  const value = Number([first, ...rest].join(''));
  if (!Number.isSafeInteger(value) || value < MIN_VND_PRICE || value > MAX_VND_PRICE) {
    return null;
  }
  return value;
}
