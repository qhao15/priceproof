/** Fixed seed: changing it changes the whole catalog and every simulated price. */
export const DEMO_SEED = 'priceproof-demo-v1';

/** FNV-1a 32-bit hash. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A stateless pseudo-random number in [0, 1) derived from the seed and the given keys.
 * The same keys always give the same number, on any machine.
 */
export function unit(...keys: (string | number)[]): number {
  // One round of mulberry32 on the hash spreads nearby inputs apart.
  let t = (fnv1a(`${DEMO_SEED}|${keys.join('|')}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A pseudo-random integer in [min, max], inclusive. */
export function intBetween(min: number, max: number, ...keys: (string | number)[]): number {
  return min + Math.floor(unit(...keys) * (max - min + 1));
}

/** A pseudo-random number in [min, max). */
export function between(min: number, max: number, ...keys: (string | number)[]): number {
  return min + unit(...keys) * (max - min);
}

/** A pseudo-random element of a non-empty list. */
export function pick<T>(items: readonly T[], ...keys: (string | number)[]): T {
  return items[Math.floor(unit(...keys) * items.length)]!;
}
