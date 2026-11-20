import { parseVndPrice } from '@priceproof/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import {
  DEMO_BANNER_TEXT,
  type DemoTruth,
  type RunningDemoStores,
  SHOPJS_LOADING_TEXT,
  startDemoStores,
  stopDemoStores,
} from '../src/index.js';
import { advertisedPct, discountAt, readJsonLd } from './helpers.js';

const FIXED_NOW = '2026-12-12T03:00:00Z';
const silent = pino({ level: 'silent' });
let stores: RunningDemoStores;

async function get(url: string): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(url);
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get('content-type') ?? '',
  };
}

beforeAll(async () => {
  stores = await startDemoStores({
    demoMartPort: 0,
    shopJsPort: 0,
    fixedNow: FIXED_NOW,
    faults: [],
    logger: silent,
    env: {},
  });
});

afterAll(async () => {
  await stopDemoStores();
});

describe('embedded mode', () => {
  it('starts both stores on random ports', () => {
    expect(stores.demoMartPort).toBeGreaterThan(0);
    expect(stores.shopJsPort).toBeGreaterThan(0);
    expect(stores.demoMartPort).not.toBe(stores.shopJsPort);
  });

  it('refuses to start a second pair in the same process', async () => {
    await expect(startDemoStores({ demoMartPort: 0, shopJsPort: 0, env: {} })).rejects.toThrow(
      /already running/,
    );
  });
});

describe.each([
  ['DemoMart', () => stores.demoMartUrl],
  ['ShopJS', () => stores.shopJsUrl],
])('%s pages', (_name, base) => {
  it('serves robots.txt that disallows /cart', async () => {
    const res = await get(`${base()}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('User-agent: *\nDisallow: /cart\n');
  });

  it('labels every page as a demo store and uses only relative links', async () => {
    const pages = ['/', '/c/phone', '/c/laptop?page=2', '/cart', '/does-not-exist'];
    for (const path of pages) {
      const res = await get(`${base()}${path}`);
      expect(res.text, path).toContain(DEMO_BANNER_TEXT);
      expect(res.text, path).not.toMatch(/(href|src)="(https?:)?\/\//);
    }
  });

  it('paginates categories, 24 items per page, with a next link until the last page', async () => {
    const count = (html: string) =>
      (html.match(/<(li|article) class="[^"]*card" data-/g) ?? []).length;
    const first = await get(`${base()}/c/phone`);
    expect(first.status).toBe(200);
    expect(count(first.text)).toBe(24);
    expect(first.text).toContain('rel="next" href="phone?page=2"');
    let page = 1;
    let html = first.text;
    while (html.includes('rel="next"')) {
      page++;
      html = (await get(`${base()}/c/phone?page=${page}`)).text;
    }
    expect(page).toBeGreaterThanOrEqual(2);
    expect(count(html)).toBeGreaterThan(0);
    expect(count(html)).toBeLessThanOrEqual(24);
    expect((await get(`${base()}/c/phone?page=${page + 1}`)).status).toBe(404);
  });

  it('answers 404 for unknown categories, bad page numbers and unknown products', async () => {
    for (const path of ['/c/tablet', '/c/phone?page=0', '/c/phone?page=abc', '/p/nope', '/x/y']) {
      const res = await get(`${base()}${path}`);
      expect(res.status, path).toBe(404);
      expect(res.type).toContain('text/html');
    }
  });

  it('serves the cart page', async () => {
    expect((await get(`${base()}/cart`)).status).toBe(200);
  });

  it('shows the running sale event', async () => {
    expect((await get(`${base()}/`)).text).toContain('Siêu sale 12.12');
  });
});

describe('DemoMart', () => {
  it('renders prices into the category HTML', async () => {
    const html = (await get(`${stores.demoMartUrl}/c/laptop`)).text;
    const prices = [...html.matchAll(/<span class="price now">([^<]+)<\/span>/g)].map((m) =>
      parseVndPrice(m[1]),
    );
    expect(prices.length).toBeGreaterThan(20);
    expect(prices.every((p) => p !== null && p > 1_000_000)).toBe(true);
  });

  it('includes JSON-LD Product / Offer on product pages', async () => {
    const truth = (await (await fetch(`${stores.demoMartUrl}/__demo/truth`)).json()) as DemoTruth;
    const listing = truth.products
      .flatMap((p) => p.listings)
      .find((l) => l.storeId === 'demomart' && !l.contactOnly)!;
    const html = (await get(`${stores.demoMartUrl}${listing.path}`)).text;
    const ld = readJsonLd(html);
    expect(ld.sku).toBe(listing.storeProductId);
    expect(ld.price).toBeGreaterThan(0);
    expect(html).toContain(`<span class="price now">`);
  });
});

describe('ShopJS', () => {
  it('shows no prices in the HTML (fetched without JavaScript)', async () => {
    for (const path of ['/c/phone', '/c/laptop', '/c/headphones?page=2']) {
      const html = (await get(`${stores.shopJsUrl}${path}`)).text;
      expect(html, path).toContain(SHOPJS_LOADING_TEXT);
      expect(html, path).not.toContain('₫');
      expect(html, path).not.toMatch(/\d{1,3}(?:[.,]\d{3})+/);
      expect(html, path).not.toMatch(/\d{6,}/);
      expect(html, path).toContain('data-prices-loaded="false"');
      expect(html, path).toContain('src="../static/shop.js"');
    }
    const truth = (await (await fetch(`${stores.shopJsUrl}/__demo/truth`)).json()) as DemoTruth;
    const listing = truth.products.flatMap((p) => p.listings).find((l) => l.storeId === 'shopjs')!;
    const product = (await get(`${stores.shopJsUrl}${listing.path}`)).text;
    expect(product).toContain(SHOPJS_LOADING_TEXT);
    expect(product).not.toContain('₫');
    expect(product).not.toContain('application/ld+json');
  });

  it('serves the client script and the prices API', async () => {
    const js = await get(`${stores.shopJsUrl}/static/shop.js`);
    expect(js.status).toBe(200);
    expect(js.type).toContain('javascript');
    expect(js.text).toContain('data-prices-loaded');

    const html = (await get(`${stores.shopJsUrl}/c/phone`)).text;
    const ids = [...html.matchAll(/data-sku="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(24);
    const res = await fetch(`${stores.shopJsUrl}/api/prices?ids=${ids.join(',')},unknown`);
    const body = (await res.json()) as {
      items: { id: string; price: number | null; listPrice: number | null; inStock: boolean }[];
    };
    expect(body.items.map((i) => i.id)).toEqual(ids);

    expect((await fetch(`${stores.shopJsUrl}/api/prices`)).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `x${i}`).join(',');
    expect((await fetch(`${stores.shopJsUrl}/api/prices?ids=${tooMany}`)).status).toBe(400);
  });
});

describe(`12.12 scenarios at DEMO_FIXED_NOW=${FIXED_NOW}, checked against /__demo/truth`, () => {
  const event = '12-12-2026';
  const now = new Date(FIXED_NOW);

  async function observe(storeId: 'demomart' | 'shopjs', storeProductId: string, path: string) {
    if (storeId === 'demomart') {
      return readJsonLd((await get(`${stores.demoMartUrl}${path}`)).text);
    }
    const res = await fetch(`${stores.shopJsUrl}/api/prices?ids=${storeProductId}`);
    const { items } = (await res.json()) as {
      items: { price: number | null; listPrice: number | null; inStock: boolean }[];
    };
    return items[0]!;
  }

  it('honest products show a real discount; inflated ones advertise much more than the real one', async () => {
    const truth = (await (await fetch(`${stores.demoMartUrl}/__demo/truth`)).json()) as DemoTruth;
    const results = { honest: 0, inflated: 0 };
    for (const product of truth.products) {
      const scenario = product.scenarios[event];
      if (scenario !== 'honest' && scenario !== 'inflated') continue;
      for (const l of product.listings) {
        if (l.contactOnly) continue;
        const seen = await observe(l.storeId, l.storeProductId, l.path);
        expect(seen.inStock).toBe(true);
        const advertised = advertisedPct(seen.price!, seen.listPrice);
        const { realDiscountPct, price } = discountAt(product.productId, l.storeId, now);
        expect(seen.price, l.path).toBe(price);
        const real = realDiscountPct!;
        if (scenario === 'honest') {
          // real_discount: at least 5% below the 30-day low, close to what is advertised
          expect(real, l.path).toBeGreaterThanOrEqual(8);
          expect(advertised - real, l.path).toBeLessThan(5);
        } else {
          // smaller_than_advertised / no_real_discount: a large gap
          expect(advertised, l.path).toBeGreaterThanOrEqual(15);
          expect(real, l.path).toBeLessThanOrEqual(0);
          expect(advertised - real, l.path).toBeGreaterThanOrEqual(15);
        }
        results[scenario]++;
      }
    }
    expect(results.honest).toBeGreaterThan(20);
    expect(results.inflated).toBeGreaterThan(20);
  });
});
