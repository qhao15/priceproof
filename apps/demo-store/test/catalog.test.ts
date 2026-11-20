import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CATEGORY_KEYS, normalizeText } from '@priceproof/shared';
import { describe, expect, it } from 'vitest';
import { COLOR_NAMES_VI, DEMO_STORE_IDS, getCatalog, getTruth } from '../src/index.js';

const require = createRequire(import.meta.url);
const usedMarkers = JSON.parse(
  readFileSync(require.resolve('@priceproof/shared/data/used-markers.json'), 'utf8'),
) as { phrases: string[]; rawTitlePatterns: string[] };
const colors = JSON.parse(
  readFileSync(require.resolve('@priceproof/shared/data/colors.json'), 'utf8'),
) as Record<string, string[]>;

function looksUsed(title: string): boolean {
  const n = ` ${normalizeText(title)} `;
  return (
    usedMarkers.phrases.some((p) => n.includes(` ${p} `)) ||
    usedMarkers.rawTitlePatterns.some((p) => new RegExp(p, 'i').test(title))
  );
}

const { products, listings, listingsByStore } = getCatalog();

describe('demo catalog', () => {
  it('has about 60 products per category, only fictional brands', () => {
    for (const category of CATEGORY_KEYS) {
      const count = products.filter((p) => p.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(55);
      expect(count, category).toBeLessThanOrEqual(65);
    }
    expect(new Set(products.map((p) => p.brand))).toEqual(
      new Set(['Novix', 'Zentra', 'Kestrel', 'Corvane', 'Auralis', 'Orcana']),
    );
  });

  it('has unique product IDs and base prices ending in 90.000', () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
    for (const p of products) {
      expect(p.basePrice % 100_000, p.id).toBe(90_000);
      expect(p.basePrice, p.id).toBeGreaterThan(500_000);
    }
  });

  it('lets each store sell about 85% of the catalog', () => {
    for (const storeId of DEMO_STORE_IDS) {
      const sold = new Set(listingsByStore[storeId].map((l) => l.productId)).size;
      expect(sold / products.length, storeId).toBeGreaterThan(0.78);
      expect(sold / products.length, storeId).toBeLessThan(0.92);
    }
    const soldAnywhere = new Set(listings.map((l) => l.productId));
    expect(soldAnywhere.size).toBe(products.length);
  });

  it('has unique store product IDs and slugs per store', () => {
    for (const storeId of DEMO_STORE_IDS) {
      const ls = listingsByStore[storeId];
      expect(new Set(ls.map((l) => l.storeProductId)).size).toBe(ls.length);
      expect(new Set(ls.map((l) => l.slug)).size).toBe(ls.length);
      for (const l of ls) {
        expect(l.slug).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('includes the tricky near-duplicates', () => {
    const names = new Set(products.filter((p) => !p.used).map((p) => `${p.brand} ${p.model}`));
    for (const name of ['Novix X5', 'Novix X5 Pro', 'Novix X5 Pro Max', 'Novix 14', 'Novix 15']) {
      expect(names, name).toContain(name);
    }
    const x5 = products.filter((p) => p.model === 'X5' && !p.used);
    expect(new Set(x5.map((p) => p.storageGb))).toEqual(new Set([128, 256]));
    expect(new Set(x5.map((p) => p.ramGb))).toEqual(new Set([8, 12]));
    expect(products.some((p) => p.storageGb === 512 && p.category === 'phone')).toBe(true);
    // Same model, 4G and 5G
    const a3 = products.filter((p) => p.model === 'A3');
    expect(new Set(a3.map((p) => p.network))).toEqual(new Set(['4G', '5G']));
    // Same laptop model code with i5 and i7
    const ka14 = products.filter((p) => p.modelCode === 'KA14-512' && !p.used);
    expect(new Set(ka14.map((p) => p.cpu?.short))).toEqual(new Set(['i5', 'i7']));
  });

  it('marks used items with used markers in every store title', () => {
    const used = products.filter((p) => p.used);
    expect(used.length).toBeGreaterThanOrEqual(6);
    for (const l of listings) {
      const p = getCatalog().productById.get(l.productId)!;
      expect(looksUsed(l.title), l.title).toBe(p.used);
    }
  });

  it('uses store-specific titles with Vietnamese marketing words', () => {
    const dm = listingsByStore.demomart.map((l) => l.title);
    const sj = listingsByStore.shopjs.map((l) => l.title);
    expect(dm.some((t) => t.startsWith('Điện thoại '))).toBe(true);
    expect(dm.some((t) => t.includes('Chính hãng'))).toBe(true);
    expect(new Set(dm).size).toBe(dm.length);
    // No title is shared between the stores.
    expect(dm.filter((t) => sj.includes(t))).toEqual([]);
  });

  it('lets ShopJS list some phone colors separately, with the color at the end', () => {
    const split = listingsByStore.shopjs.filter((l) => l.category === 'phone' && l.color);
    expect(split.length).toBeGreaterThan(10);
    for (const l of split) {
      const tail = normalizeText(l.title.split(' - ').at(-1)!);
      expect(colors[l.color!], l.title).toContain(tail);
      expect(tail).toBe(normalizeText(COLOR_NAMES_VI[l.color!]));
    }
    const perProduct = new Map<string, number>();
    for (const l of split) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + 1);
    expect(Math.max(...perProduct.values())).toBeGreaterThan(1);
  });

  it('has a few "Liên hệ" listings', () => {
    const contact = listings.filter((l) => l.contactOnly);
    expect(contact.length).toBeGreaterThan(0);
    expect(contact.length).toBeLessThan(listings.length * 0.08);
  });
});

describe('ground truth', () => {
  it('groups every listing under its product', () => {
    const truth = getTruth();
    expect(truth.products).toHaveLength(products.length);
    const total = truth.products.reduce((n, p) => n + p.listings.length, 0);
    expect(total).toBe(listings.length);
    expect(truth.events.map((e) => e.id)).toEqual([
      '11-11-2026',
      'black-friday-2026',
      '12-12-2026',
    ]);
    for (const p of truth.products) {
      expect(Object.keys(p.scenarios)).toHaveLength(3);
      if (p.used) {
        expect(Object.values(p.scenarios).every((s) => s === 'none')).toBe(true);
      }
    }
  });

  it('assigns every scenario to some products for each event', () => {
    const truth = getTruth();
    for (const event of truth.events) {
      const counts = new Map<string, number>();
      for (const p of truth.products) {
        const s = p.scenarios[event.id]!;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      for (const s of ['honest', 'inflated', 'silent_drop', 'none']) {
        expect(counts.get(s) ?? 0, `${event.id} ${s}`).toBeGreaterThan(10);
      }
    }
  });
});
