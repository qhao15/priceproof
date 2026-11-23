import { normalizeText } from '../text/normalize-text.js';
import { readDataFile } from './data.js';

/**
 * The canonical brand key of a title (SPEC §8.4 step 9): the first token, or two-token phrase,
 * found among the aliases in `brands.json`. Null when no brand is known.
 */
export function detectBrand(title: string): string | null {
  const brands = readDataFile<Record<string, string[]>>('brands.json');
  const aliasToBrand = new Map<string, string>();
  for (const [key, aliases] of Object.entries(brands)) {
    for (const alias of aliases) aliasToBrand.set(alias, key);
  }
  const tokens = normalizeText(title).split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;
    if (pair && aliasToBrand.has(pair)) return aliasToBrand.get(pair)!;
    if (aliasToBrand.has(tokens[i]!)) return aliasToBrand.get(tokens[i]!)!;
  }
  return null;
}

/** `products.searchText` (SPEC §6.5): normalized name plus the brand key when known. */
export function productSearchText(name: string, brand: string | null): string {
  const n = normalizeText(name);
  return brand ? `${n} ${brand}` : n;
}
