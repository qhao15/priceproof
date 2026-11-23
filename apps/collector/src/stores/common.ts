import { createHash } from 'node:crypto';
import { type ScrapedItem, ScrapedItemSchema, urlKey } from '@priceproof/shared';

/** Tracking parameters removed from canonical URLs. */
const TRACKING_PARAM = /^(utm_\w+|gclid|fbclid|ref|source)$/i;

/** Signs of a CAPTCHA or bot challenge page. */
const CHALLENGE_MARKERS = [
  /id=["']captcha["']/i,
  /\bcaptcha\b/i,
  /g-recaptcha|h-captcha|hcaptcha|cf-challenge|cf-turnstile/i,
  /không phải là robot/i,
];

/**
 * Block detection shared by every adapter (hard rule: on 403, 429, a CAPTCHA or a block page,
 * pause the store and report it). Returns the reason, or null.
 */
export function detectCommonBlock(html: string, httpStatus: number): string | null {
  if (httpStatus === 403) return 'http_403';
  if (httpStatus === 429) return 'http_429';
  if (CHALLENGE_MARKERS.some((re) => re.test(html))) return 'captcha';
  return null;
}

/** Removes the hash and tracking parameters. */
export function canonicalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

/** Maps URLs between a store's public base URL and the base URL the collector fetches from. */
export function baseUrlMapper(publicBase: string, fetchBase: string) {
  const swap = (url: string, from: string, to: string) =>
    url.startsWith(from) ? to + url.slice(from.length) : url;
  return {
    toFetchUrl: (publicUrl: string) => swap(publicUrl, publicBase, fetchBase),
    toPublicUrl: (fetchUrl: string) => swap(fetchUrl, fetchBase, publicBase),
  };
}

/** First 16 hex characters of the SHA-1 of the urlKey (SPEC §9.2), when a store shows no ID. */
export function storeProductIdFromUrl(url: string): string {
  return createHash('sha1').update(urlKey(url)).digest('hex').slice(0, 16);
}

export interface RawItem {
  storeProductId: string;
  url: string;
  title: string;
  category: ScrapedItem['category'];
  price: number | null;
  listPrice: number | null;
  inStock: boolean;
  variant?: ScrapedItem['variant'];
}

/**
 * Applies the adapter rules (a list price not above the price becomes null) and validates the
 * item against the collected-fields whitelist.
 */
export function finalizeItem(
  raw: RawItem,
): { ok: true; item: ScrapedItem } | { ok: false; error: string } {
  const listPrice =
    raw.listPrice !== null && raw.price !== null && raw.listPrice <= raw.price
      ? null
      : raw.listPrice;
  const parsed = ScrapedItemSchema.safeParse({ ...raw, listPrice });
  if (!parsed.success) {
    return {
      ok: false,
      error: `${raw.storeProductId || raw.url}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    };
  }
  return { ok: true, item: parsed.data };
}

/** Resolves a (relative) link found on a page. */
export function resolveLink(href: string, pageUrl: string): string {
  return new URL(href, pageUrl).toString();
}
