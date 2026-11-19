import { Long } from 'mongodb';

/**
 * Converts integer VND to BSON Int64 for writing to MongoDB (SPEC §6.1).
 * Reads come back as plain numbers (driver default `promoteLongs`).
 *
 * @throws RangeError when the amount is not a non-negative safe integer.
 */
export function toMongoMoney(amount: number): Long {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Money must be a non-negative integer number of VND, got ${amount}`);
  }
  return Long.fromNumber(amount);
}

/** Same as {@link toMongoMoney}, but passes null through (for optional money fields). */
export function toMongoMoneyOrNull(amount: number | null): Long | null {
  return amount === null ? null : toMongoMoney(amount);
}

/** Reads a money value that may be a number or an Int64 (when `promoteLongs` is off). */
export function fromMongoMoney(value: number | Long): number {
  if (typeof value === 'number') {
    return value;
  }
  const n = value.toNumber();
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Money value is outside the safe integer range: ${value.toString()}`);
  }
  return n;
}
