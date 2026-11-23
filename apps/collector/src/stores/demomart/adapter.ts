import {
  canonicalColor,
  type CategoryKey,
  isCategoryKey,
  isUsedTitle,
  parseVndPrice,
  type ScrapedItem,
} from '@priceproof/shared';
import { type CheerioAPI, load } from 'cheerio';
import {
  baseUrlMapper,
  canonicalizeUrl,
  detectCommonBlock,
  finalizeItem,
  resolveLink,
} from '../common.js';
import type { CategoryPage, ParseResult, StoreAdapter } from '../types.js';

/**
 * DemoMart (fictional demo store, plain HTTP). Category pages are server-rendered HTML; product
 * pages carry JSON-LD `Product` / `Offer`, which is preferred over the CSS selectors.
 */

interface JsonLdOffer {
  price?: number | string;
  availability?: string;
  priceSpecification?:
    | { priceType?: string; price?: number | string }
    | { priceType?: string; price?: number | string }[];
}

interface JsonLdProduct {
  '@type'?: string;
  name?: string;
  sku?: string;
  offers?: JsonLdOffer | JsonLdOffer[];
}

function money(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  return parseVndPrice(value);
}

function readJsonLd($: CheerioAPI): JsonLdProduct | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text()) as JsonLdProduct | JsonLdProduct[];
      const product = (Array.isArray(data) ? data : [data]).find((d) => d['@type'] === 'Product');
      if (product) return product;
    } catch {
      // Not valid JSON: try the next script, then fall back to CSS selectors.
    }
  }
  return null;
}

function categoryFromBreadcrumb($: CheerioAPI): CategoryKey | null {
  const href = $('nav.breadcrumb a').first().attr('href') ?? '';
  const key = /\/c\/([a-z]+)/.exec(href)?.[1] ?? null;
  return key && isCategoryKey(key) ? key : null;
}

function variantFromSpecs($: CheerioAPI): ScrapedItem['variant'] {
  const variant: NonNullable<ScrapedItem['variant']> = {};
  $('dl.specs dt').each((_i, dt) => {
    const label = $(dt).text().trim().toLowerCase();
    const value = $(dt).next('dd').text().trim();
    const gb = /^(\d+)\s*(GB|TB)$/i.exec(value);
    const size = gb ? Number(gb[1]) * (gb[2]!.toUpperCase() === 'TB' ? 1024 : 1) : null;
    if (label === 'ram' && size) variant.ramGb = size;
    if (label === 'bộ nhớ' && size) variant.storageGb = size;
    if (label === 'màu sắc') {
      const color = canonicalColor(value);
      if (color) variant.color = color;
    }
  });
  return Object.keys(variant).length > 0 ? variant : undefined;
}

export function createDemoMartAdapter(options: {
  publicUrl: string;
  fetchUrl: string;
}): StoreAdapter {
  const urls = baseUrlMapper(options.publicUrl, options.fetchUrl);
  const toPublic = (fetchUrl: string) => canonicalizeUrl(urls.toPublicUrl(fetchUrl));

  const adapter: StoreAdapter = {
    storeId: 'demomart',
    fetchMethod: 'http',
    categoryStartUrls: (category) => [`${options.publicUrl}/c/${category}`],
    canonicalUrl: canonicalizeUrl,
    toFetchUrl: urls.toFetchUrl,
    toPublicUrl: urls.toPublicUrl,
    detectBlock: detectCommonBlock,

    parseCategoryPage(html, url, category): ParseResult<CategoryPage> {
      const $ = load(html);
      const cards = $('li.product-card');
      if (cards.length === 0) {
        return $('ul.product-list').length > 0
          ? { ok: true, data: { items: [], nextPageUrl: null, skippedUsed: 0 } }
          : {
              ok: false,
              reason: 'parse_error',
              message: 'Product list not found (layout change?)',
            };
      }
      const items: ScrapedItem[] = [];
      const errors: string[] = [];
      let skippedUsed = 0;
      cards.each((_i, el) => {
        const card = $(el);
        const link = card.find('a.product-title').first();
        const title = link.text().trim();
        if (isUsedTitle(title)) {
          skippedUsed++;
          return;
        }
        const priceText = card.find('.price').first().text().trim();
        const result = finalizeItem({
          storeProductId: card.attr('data-product-id') ?? '',
          url: toPublic(resolveLink(link.attr('href') ?? '', url)),
          title,
          category,
          price: parseVndPrice(priceText),
          listPrice: parseVndPrice(card.find('.list-price').first().text()),
          inStock: card.find('.stock').first().hasClass('in-stock'),
        });
        if (result.ok) items.push(result.item);
        else errors.push(result.error);
      });
      if (items.length > 0 && items.every((i) => i.price === null)) {
        return {
          ok: false,
          reason: 'parse_error',
          message: 'Items without any price (layout change?)',
        };
      }
      if (items.length === 0 && errors.length > 0) {
        return { ok: false, reason: 'parse_error', message: errors.slice(0, 3).join(' | ') };
      }
      const next = $('a.next-page[rel="next"]').first().attr('href');
      return {
        ok: true,
        data: {
          items,
          nextPageUrl: next ? urls.toPublicUrl(resolveLink(next, url)) : null,
          skippedUsed,
        },
      };
    },

    parseProductPage(html, url, httpStatus): ParseResult<ScrapedItem[]> {
      if (httpStatus === 404) {
        return { ok: false, reason: 'not_found', message: 'HTTP 404' };
      }
      const $ = load(html);
      const category = categoryFromBreadcrumb($);
      const ld = readJsonLd($);
      const detail = $('article.product-detail');
      if (!category || (!ld && detail.length === 0)) {
        return { ok: false, reason: 'parse_error', message: 'No product data on the page' };
      }
      const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
      const specs = offer?.priceSpecification;
      const listSpec = (Array.isArray(specs) ? specs : specs ? [specs] : []).find((s) =>
        s.priceType?.endsWith('ListPrice'),
      );
      const title = (ld?.name ?? detail.find('h1.product-name').text()).trim();
      if (isUsedTitle(title)) {
        return { ok: true, data: [] };
      }
      const result = finalizeItem({
        storeProductId: ld?.sku ?? detail.attr('data-product-id') ?? '',
        url: toPublic(url),
        title,
        category,
        price: ld ? money(offer?.price) : parseVndPrice(detail.find('.price').first().text()),
        listPrice: ld
          ? money(listSpec?.price)
          : parseVndPrice(detail.find('.list-price').first().text()),
        inStock: offer?.availability
          ? offer.availability.endsWith('/InStock')
          : detail.find('.stock').first().hasClass('in-stock'),
        variant: variantFromSpecs($),
      });
      return result.ok
        ? { ok: true, data: [result.item] }
        : { ok: false, reason: 'parse_error', message: result.error };
    },
  };
  return adapter;
}
