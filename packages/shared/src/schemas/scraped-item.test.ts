import { describe, expect, it } from 'vitest';
import { isCategoryKey } from '../categories.js';
import { ScrapedItemSchema } from './scraped-item.js';

const valid = {
  storeProductId: 'dm-10231',
  url: 'http://localhost:4000/p/kestrel-air-14-ka14-512',
  title: 'Laptop Kestrel Air 14 KA14-512 i5 1335U/16GB/512GB - Chính hãng',
  category: 'laptop',
  price: 20_000_000,
  listPrice: 25_000_000,
  inStock: true,
  variant: { color: 'silver', storageGb: 512, ramGb: 16 },
};

describe('ScrapedItemSchema', () => {
  it('accepts a valid item', () => {
    expect(ScrapedItemSchema.parse(valid)).toEqual(valid);
  });

  it('accepts "Liên hệ" items without a price and items without a variant', () => {
    const { variant: _variant, ...noVariant } = valid;
    expect(
      ScrapedItemSchema.safeParse({ ...noVariant, price: null, listPrice: null }).success,
    ).toBe(true);
  });

  it('rejects fields outside the hard-rule whitelist (SPEC §3)', () => {
    expect(ScrapedItemSchema.safeParse({ ...valid, imageUrl: 'http://x/y.jpg' }).success).toBe(
      false,
    );
    expect(
      ScrapedItemSchema.safeParse({ ...valid, variant: { color: 'red', seller: 'A' } }).success,
    ).toBe(false);
  });

  it.each([
    ['a relative URL', { url: '/p/x' }],
    ['an unknown category', { category: 'tablet' }],
    ['a non-integer price', { price: 1999.5 }],
    ['a price below 1.000', { price: 999 }],
    ['an empty title', { title: '   ' }],
    ['an empty store product ID', { storeProductId: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(ScrapedItemSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('isCategoryKey', () => {
  it('recognizes the v1 categories only', () => {
    expect(['phone', 'laptop', 'headphones'].every(isCategoryKey)).toBe(true);
    expect(isCategoryKey('tablet')).toBe(false);
  });
});
