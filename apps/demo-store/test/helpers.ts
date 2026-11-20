import { type DemoStoreId, priceAt } from '../src/index.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface DiscountCheck {
  price: number;
  listPrice: number | null;
  referencePrice: number | null;
  realDiscountPct: number | null;
  advertisedDiscountPct: number;
}

/**
 * A small stand-in for the discount engine (SPEC §7.2), which arrives in M2: samples `priceAt`
 * every hour (every demo price change happens on a whole hour), finds when the current price
 * started, and takes the lowest in-stock price of the 30 days before that.
 */
export function discountAt(productId: string, storeId: DemoStoreId, now: Date): DiscountCheck {
  const t = now.getTime();
  const current = priceAt(productId, storeId, t);
  if (current.price === null) {
    throw new Error(`${productId} shows no price at ${storeId}`);
  }
  // Start of the current price run.
  let since = t;
  for (let at = t - HOUR_MS; at > t - 90 * DAY_MS; at -= HOUR_MS) {
    const p = priceAt(productId, storeId, at);
    if (p.price !== current.price || !p.inStock) {
      break;
    }
    since = at;
  }
  let reference: number | null = null;
  for (let at = since - HOUR_MS; at >= since - 30 * DAY_MS; at -= HOUR_MS) {
    const p = priceAt(productId, storeId, at);
    if (p.inStock && p.price !== null) {
      reference = reference === null ? p.price : Math.min(reference, p.price);
    }
  }
  const advertisedRaw =
    current.listPrice !== null && current.listPrice > current.price
      ? round1(((current.listPrice - current.price) / current.listPrice) * 100)
      : 0;
  return {
    price: current.price,
    listPrice: current.listPrice,
    referencePrice: reference,
    realDiscountPct:
      reference === null ? null : round1(((reference - current.price) / reference) * 100),
    advertisedDiscountPct: advertisedRaw < 3 ? 0 : advertisedRaw,
  };
}

/** Advertised discount in percent, from a price and list price read off a page. */
export function advertisedPct(price: number, listPrice: number | null): number {
  if (listPrice === null || listPrice <= price) {
    return 0;
  }
  const pct = round1(((listPrice - price) / listPrice) * 100);
  return pct < 3 ? 0 : pct;
}

/** Reads the JSON-LD `Product` of a DemoMart product page. */
export function readJsonLd(html: string): {
  sku: string;
  price: number | null;
  listPrice: number | null;
  inStock: boolean;
} {
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  if (!match) {
    throw new Error('No JSON-LD on the page');
  }
  const data = JSON.parse(match[1]!) as {
    sku: string;
    offers: {
      price?: number;
      availability: string;
      priceSpecification?: { price: number };
    };
  };
  return {
    sku: data.sku,
    price: data.offers.price ?? null,
    listPrice: data.offers.priceSpecification?.price ?? null,
    inStock: data.offers.availability === 'https://schema.org/InStock',
  };
}
