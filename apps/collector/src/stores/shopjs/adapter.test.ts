import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createShopJsAdapter, SHOPJS_READY_SELECTOR } from './adapter.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const adapter = createShopJsAdapter({
  publicUrl: 'http://localhost:4001',
  fetchUrl: 'http://localhost:4001',
});

describe('ShopJS adapter', () => {
  it('is a browser store that waits for the prices to load', () => {
    expect(adapter.fetchMethod).toBe('browser');
    expect(adapter.readySelector).toBe(SHOPJS_READY_SELECTOR);
  });

  it('parses a rendered category page', () => {
    const r = adapter.parseCategoryPage(
      fixture('category-rendered.html'),
      'http://localhost:4001/c/phone',
      'phone',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toHaveLength(2);
    expect(r.data.skippedUsed).toBe(1);
    expect(r.data.items[0]).toEqual({
      storeProductId: 'sj0001',
      url: 'http://localhost:4001/p/sj0001-novix-x5-8gb-128gb-black',
      title: 'Novix X5 5G 128GB (8GB RAM) - Đen',
      category: 'phone',
      price: 10_190_000,
      listPrice: 13_490_000,
      inStock: true,
    });
    expect(r.data.items[1]).toMatchObject({ price: null, inStock: false });
    expect(r.data.nextPageUrl).toBe('http://localhost:4001/c/phone?page=2');
  });

  it('rejects the HTML shell whose prices are not loaded yet', () => {
    const r = adapter.parseCategoryPage(
      fixture('category-shell.html'),
      'http://localhost:4001/c/phone',
      'phone',
    );
    expect(r).toMatchObject({ ok: false, reason: 'parse_error' });
  });

  it('reports a layout change as a parse error', () => {
    const r = adapter.parseCategoryPage(
      fixture('category-layout-v2.html'),
      'http://localhost:4001/c/phone',
      'phone',
    );
    expect(r).toMatchObject({ ok: false, reason: 'parse_error' });
  });

  it('parses a rendered product page', () => {
    const r = adapter.parseProductPage(
      fixture('product-rendered.html'),
      'http://localhost:4001/p/sj0071-kestrel-air-14',
      200,
    );
    expect(r).toEqual({
      ok: true,
      data: [
        {
          storeProductId: 'sj0071',
          url: 'http://localhost:4001/p/sj0071-kestrel-air-14',
          title: 'Kestrel Air 14 (KA14-512) 16GB 512GB Bạc',
          category: 'laptop',
          price: 18_290_000,
          listPrice: 20_490_000,
          inStock: true,
        },
      ],
    });
  });

  it('recognizes not-found and block pages', () => {
    expect(
      adapter.parseProductPage(fixture('not-found.html'), 'http://localhost:4001/p/x', 404),
    ).toMatchObject({ ok: false, reason: 'not_found' });
    expect(adapter.detectBlock(fixture('captcha.html'), 200)).toBe('captcha');
  });
});
