import type { CategoryKey, FetchMethod, ScrapedItem } from '@priceproof/shared';

/**
 * A store as defined in code (SPEC §6.3 `stores`). db:init writes the code-owned fields
 * (`name`, `isDemo`, `hosts`, `baseUrl`, `showLinks`, `fetchMethod`, category keys and start
 * URLs) and only seeds the admin-owned ones.
 */
export interface StoreDefinition {
  id: string;
  name: string;
  isDemo: boolean;
  /** host[:port] values that identify this store's public URLs. */
  hosts: string[];
  /** Public base URL, used in links shown to users. */
  baseUrl: string;
  showLinks: boolean;
  fetchMethod: FetchMethod;
  /** Seeded value of `enabled`: real stores start disabled until the owner enables them. */
  enabledByDefault: boolean;
  /** Seeded value of `rateLimit.requestsPerMinute` (default 20, never above 60). */
  requestsPerMinute: number;
  categories: { key: CategoryKey; startUrls: string[]; crawlEveryMinutes: number }[];
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'blocked' | 'not_found' | 'parse_error'; message: string };

/** A parsed category page. `skippedUsed` counts used / display items that were left out. */
export interface CategoryPage {
  items: ScrapedItem[];
  nextPageUrl: string | null;
  skippedUsed: number;
}

/** Store adapter (SPEC §9.2). Adapters parse HTML strings, so fixtures cover both fetch methods. */
export interface StoreAdapter {
  storeId: string;
  fetchMethod: FetchMethod;
  /** Browser stores: wait for this selector before parsing. */
  readySelector?: string;
  categoryStartUrls(category: CategoryKey): string[];
  parseCategoryPage(html: string, url: string, category: CategoryKey): ParseResult<CategoryPage>;
  parseProductPage(html: string, url: string, httpStatus: number): ParseResult<ScrapedItem[]>;
  /** Block reason, or null. */
  detectBlock(html: string, httpStatus: number): string | null;
  /** Public canonical URL without tracking parameters. */
  canonicalUrl(url: string): string;
  /** Identity for real stores; demo stores map public → internal URL. */
  toFetchUrl(publicUrl: string): string;
  toPublicUrl(fetchUrl: string): string;
}
