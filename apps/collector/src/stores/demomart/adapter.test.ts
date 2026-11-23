import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoMartAdapter } from './adapter.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

// Public URLs differ from fetch URLs, as when the collector reaches the store another way.
const adapter = createDemoMartAdapter({
  publicUrl: 'http://localhost:4000',
  fetchUrl: 'http://127.0.0.1:5555',
});

describe('DemoMart adapter', () => {
  it('parses a category page: count, first item, out of stock, "Liên hệ", used items skipped', () => {
    const r = adapter.parseCategoryPage(
      fixture('category.html'),
      'http://127.0.0.1:5555/c/phone',
      'phone',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toHaveLength(3);
    expect(r.data.skippedUsed).toBe(1);
    expect(r.data.items[0]).toEqual({
      storeProductId: 'dm-10001',
      url: 'http://localhost:4000/p/novix-x5-8gb-128gb',
      title: 'Điện thoại Novix X5 8GB/128GB - Chính hãng, Trả góp 0%',
      category: 'phone',
      price: 10_090_000,
      listPrice: 13_390_000,
      inStock: true,
    });
    expect(r.data.items[1]).toMatchObject({ inStock: false, listPrice: null });
    expect(r.data.items[2]).toMatchObject({ storeProductId: 'dm-10007', price: null });
  });

  it('follows pagination and stops on the last page', () => {
    const first = adapter.parseCategoryPage(
      fixture('category.html'),
      'http://127.0.0.1:5555/c/phone',
      'phone',
    );
    expect(first.ok && first.data.nextPageUrl).toBe('http://localhost:4000/c/phone?page=2');
    const last = adapter.parseCategoryPage(
      fixture('category-last.html'),
      'http://127.0.0.1:5555/c/phone?page=3',
      'phone',
    );
    expect(last.ok && last.data.nextPageUrl).toBeNull();
    // A list price equal to the price becomes null.
    expect(last.ok && last.data.items[0]?.listPrice).toBeNull();
  });

  it('reports a layout change as a parse error', () => {
    const r = adapter.parseCategoryPage(
      fixture('category-layout-v2.html'),
      'http://127.0.0.1:5555/c/phone',
      'phone',
    );
    expect(r).toMatchObject({ ok: false, reason: 'parse_error' });
  });

  it('parses a product page from JSON-LD, with variant attributes', () => {
    const r = adapter.parseProductPage(
      fixture('product.html'),
      'http://127.0.0.1:5555/p/kestrel-air-14-ka14-512-i5-16gb?utm_source=x',
      200,
    );
    expect(r).toEqual({
      ok: true,
      data: [
        {
          storeProductId: 'dm-10061',
          url: 'http://localhost:4000/p/kestrel-air-14-ka14-512-i5-16gb',
          title: 'Laptop Kestrel Air 14 KA14-512 i5 1335U/16GB/512GB - Chính hãng',
          category: 'laptop',
          price: 17_990_000,
          listPrice: 19_990_000,
          inStock: true,
          variant: { ramGb: 16, storageGb: 512, color: 'silver' },
        },
      ],
    });
  });

  it('falls back to CSS selectors without JSON-LD', () => {
    const r = adapter.parseProductPage(
      fixture('product-no-jsonld.html'),
      'http://127.0.0.1:5555/p/orcana-echo-500',
      200,
    );
    expect(r.ok && r.data[0]).toMatchObject({
      storeProductId: 'dm-10130',
      category: 'headphones',
      price: 5_490_000,
      inStock: false,
    });
  });

  it('recognizes not-found pages', () => {
    expect(
      adapter.parseProductPage(fixture('not-found.html'), 'http://127.0.0.1:5555/p/x', 404),
    ).toMatchObject({ ok: false, reason: 'not_found' });
    expect(
      adapter.parseProductPage(fixture('not-found.html'), 'http://127.0.0.1:5555/p/x', 200),
    ).toMatchObject({ ok: false, reason: 'parse_error' });
  });

  it('detects block pages', () => {
    expect(adapter.detectBlock(fixture('captcha.html'), 200)).toBe('captcha');
    expect(adapter.detectBlock('Too Many Requests', 429)).toBe('http_429');
    expect(adapter.detectBlock('Forbidden', 403)).toBe('http_403');
    expect(adapter.detectBlock(fixture('category.html'), 200)).toBeNull();
  });

  it('maps public and fetch URLs', () => {
    expect(adapter.categoryStartUrls('laptop')).toEqual(['http://localhost:4000/c/laptop']);
    expect(adapter.toFetchUrl('http://localhost:4000/c/laptop?page=2')).toBe(
      'http://127.0.0.1:5555/c/laptop?page=2',
    );
    expect(adapter.toPublicUrl('http://127.0.0.1:5555/p/a')).toBe('http://localhost:4000/p/a');
    expect(adapter.canonicalUrl('http://localhost:4000/p/a?utm_medium=x&page=2#top')).toBe(
      'http://localhost:4000/p/a?page=2',
    );
  });
});
