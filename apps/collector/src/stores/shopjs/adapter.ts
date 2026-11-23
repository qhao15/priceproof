import {
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
 * ShopJS (fictional demo store, headless browser). The server HTML only shows "Đang tải giá…";
 * a script fills in prices and sets `data-prices-loaded="true"` on `<body>`. The adapter parses
 * the rendered HTML (`page.content()`).
 */

export const SHOPJS_READY_SELECTOR =
  'body[data-prices-loaded="true"], body[data-prices-loaded="error"]';

function loadState($: CheerioAPI): string {
  return $('body').attr('data-prices-loaded') ?? 'missing';
}

/** The parts of a cheerio selection that `readItem` uses. */
interface Node {
  attr(name: string): string | undefined;
  text(): string;
  first(): Node;
  find(selector: string): Node;
}

function readItem(
  el: Node,
  pageUrl: string,
  category: CategoryKey,
  toPublic: (url: string) => string,
  isProductPage: boolean,
) {
  const name = el.find('.item-name').first();
  const title = name.text().trim();
  const href = isProductPage ? pageUrl : resolveLink(name.attr('href') ?? '', pageUrl);
  const stock = el.find('.item-stock').first();
  return {
    title,
    raw: {
      storeProductId: el.attr('data-sku') ?? '',
      url: toPublic(href),
      title,
      category,
      price: parseVndPrice(el.find('.item-price').first().text()),
      listPrice: parseVndPrice(el.find('.item-old-price').first().text()),
      inStock: stock.attr('data-in-stock') === 'true',
    },
  };
}

export function createShopJsAdapter(options: {
  publicUrl: string;
  fetchUrl: string;
}): StoreAdapter {
  const urls = baseUrlMapper(options.publicUrl, options.fetchUrl);
  const toPublic = (fetchUrl: string) => canonicalizeUrl(urls.toPublicUrl(fetchUrl));

  return {
    storeId: 'shopjs',
    fetchMethod: 'browser',
    readySelector: SHOPJS_READY_SELECTOR,
    categoryStartUrls: (category) => [`${options.publicUrl}/c/${category}`],
    canonicalUrl: canonicalizeUrl,
    toFetchUrl: urls.toFetchUrl,
    toPublicUrl: urls.toPublicUrl,
    detectBlock: detectCommonBlock,

    parseCategoryPage(html, url, category): ParseResult<CategoryPage> {
      const $ = load(html);
      const cards = $('article.item[data-sku]');
      if (cards.length === 0) {
        return $('div.items').length > 0
          ? { ok: true, data: { items: [], nextPageUrl: null, skippedUsed: 0 } }
          : { ok: false, reason: 'parse_error', message: 'Item grid not found (layout change?)' };
      }
      if (loadState($) !== 'true') {
        return {
          ok: false,
          reason: 'parse_error',
          message: `Prices not loaded (data-prices-loaded=${loadState($)})`,
        };
      }
      const items: ScrapedItem[] = [];
      const errors: string[] = [];
      let skippedUsed = 0;
      cards.each((_i, node) => {
        const { title, raw } = readItem($(node), url, category, toPublic, false);
        if (isUsedTitle(title)) {
          skippedUsed++;
          return;
        }
        const result = finalizeItem(raw);
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
      const card = $('article.item[data-sku]').first();
      const href = $('nav.breadcrumb a').first().attr('href') ?? '';
      const category = /\/c\/([a-z]+)/.exec(href)?.[1] ?? '';
      if (card.length === 0 || !isCategoryKey(category)) {
        return { ok: false, reason: 'parse_error', message: 'No product data on the page' };
      }
      if (loadState($) !== 'true') {
        return { ok: false, reason: 'parse_error', message: 'Prices not loaded' };
      }
      const { title, raw } = readItem(card, url, category, toPublic, true);
      if (isUsedTitle(title)) {
        return { ok: true, data: [] };
      }
      const result = finalizeItem(raw);
      return result.ok
        ? { ok: true, data: [result.item] }
        : { ok: false, reason: 'parse_error', message: result.error };
    },
  };
}
