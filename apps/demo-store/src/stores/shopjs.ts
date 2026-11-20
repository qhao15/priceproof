import { isCategoryKey } from '@priceproof/shared';
import type { Express } from 'express';
import { DEMO_STORE_NAMES, type DemoListing, getCatalog } from '../catalog.js';
import { escapeHtml, layout } from '../html.js';
import { priceAt } from '../prices.js';
import {
  ACCENTS,
  CATEGORY_NAMES_VI,
  categoryListings,
  createStoreApp,
  homeBody,
  listingBySlug,
  PAGE_SIZE,
  pageNumber,
  pagerHtml,
  rootOf,
  saleBanner,
  sendHtml,
  sendNotFound,
  type StoreContext,
} from './common.js';

/**
 * ShopJS (SPEC §14.1): the HTML is only a shell. A client script loads prices and stock from
 * `/api/prices?ids=` after a 300–800 ms delay, so a plain HTTP fetch only sees "Đang tải giá…"
 * and a headless browser is needed. When the prices are in, the script sets
 * `data-prices-loaded="true"` on `<body>`.
 */

const STORE_ID = 'shopjs';
export const SHOPJS_LOADING_TEXT = 'Đang tải giá…';
export const SHOPJS_MAX_IDS = 100;

const CLASSES = {
  v1: {
    grid: 'items',
    item: 'item',
    name: 'item-name',
    price: 'item-price',
    listPrice: 'item-old-price',
    stock: 'item-stock',
    next: 'next-page',
  },
  v2: {
    grid: 'results-v2',
    item: 'result-v2',
    name: 'result-title',
    price: 'result-cost',
    listPrice: 'result-cost-before',
    stock: 'result-availability',
    next: 'pager-forward',
  },
};
type Classes = (typeof CLASSES)['v1'];

/** The client script. Plain ES2017 without dependencies; it formats prices as "12.990.000₫". */
const SHOP_JS = `(function () {
  var body = document.body;
  var api = body.getAttribute('data-api');
  var items = Array.prototype.slice.call(document.querySelectorAll('[data-sku]'));
  function fmt(n) { return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + '\\u20ab'; }
  function role(el, name) { return el.querySelector('[data-role="' + name + '"]'); }
  var delay = 300 + Math.floor(Math.random() * 501);
  setTimeout(function () {
    if (items.length === 0) { body.setAttribute('data-prices-loaded', 'true'); return; }
    var ids = items.map(function (el) { return el.getAttribute('data-sku'); });
    fetch(api + '?ids=' + encodeURIComponent(ids.join(',')), { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
      .then(function (data) {
        var byId = {};
        data.items.forEach(function (it) { byId[it.id] = it; });
        items.forEach(function (el) {
          var it = byId[el.getAttribute('data-sku')];
          if (!it) { return; }
          role(el, 'price').textContent = it.price === null ? 'Liên hệ' : fmt(it.price);
          role(el, 'list-price').textContent = it.listPrice === null ? '' : fmt(it.listPrice);
          var stock = role(el, 'stock');
          stock.textContent = it.inStock ? 'Còn hàng' : 'Tạm hết hàng';
          stock.setAttribute('data-in-stock', it.inStock ? 'true' : 'false');
        });
        body.setAttribute('data-prices-loaded', 'true');
      })
      .catch(function () {
        items.forEach(function (el) { role(el, 'price').textContent = 'Không tải được giá'; });
        body.setAttribute('data-prices-loaded', 'error');
      });
  }, delay);
})();
`;

function itemHtml(c: Classes, l: DemoListing, root: string, tag: 'article' | 'h1'): string {
  const name =
    tag === 'h1'
      ? `<h1 class="${c.name}">${escapeHtml(l.title)}</h1>`
      : `<a class="${c.name}" href="${root}p/${l.slug}">${escapeHtml(l.title)}</a>`;
  return `<article class="${c.item} card" data-sku="${l.storeProductId}">
${name}
<div class="${c.price} now" data-role="price">${SHOPJS_LOADING_TEXT}</div>
<del class="${c.listPrice} was" data-role="list-price"></del>
<div class="${c.stock}" data-role="stock"></div>
</article>`;
}

function shellAttributes(root: string): string {
  return `data-api="${root}api/prices" data-prices-loaded="false"`;
}

export function createShopJsApp(ctx: StoreContext): Express {
  const classes = () => (ctx.faults.has('layoutV2') ? CLASSES.v2 : CLASSES.v1);
  const name = DEMO_STORE_NAMES[STORE_ID];
  const script = (root: string) => `<script src="${root}static/shop.js" defer></script>`;

  return createStoreApp(STORE_ID, ctx, (router) => {
    router.get('/static/shop.js', (_req, res) => {
      res.type('application/javascript').set('Cache-Control', 'no-store').send(SHOP_JS);
    });

    router.get('/api/prices', (req, res) => {
      const raw = req.query.ids;
      if (typeof raw !== 'string' || raw.trim() === '') {
        res.status(400).json({ error: 'ids is required (comma-separated)' });
        return;
      }
      const ids = [...new Set(raw.split(',').map((s) => s.trim()))].filter(Boolean);
      if (ids.length > SHOPJS_MAX_IDS) {
        res.status(400).json({ error: `at most ${SHOPJS_MAX_IDS} ids` });
        return;
      }
      const now = ctx.clock.now();
      const byId = new Map(getCatalog().listingsByStore.shopjs.map((l) => [l.storeProductId, l]));
      const items = ids.flatMap((id) => {
        const l = byId.get(id);
        return l ? [{ id, ...priceAt(l.productId, STORE_ID, now) }] : [];
      });
      res.set('Cache-Control', 'no-store').json({ items });
    });

    router.get('/', (req, res) => {
      sendHtml(
        res,
        200,
        layout({
          storeName: name,
          title: 'Trang chủ',
          root: rootOf(req),
          accent: ACCENTS[STORE_ID],
          saleBanner: saleBanner(ctx),
          body: homeBody(STORE_ID, 'Cửa hàng demo có giá được tải bằng JavaScript.'),
        }),
      );
    });

    router.get('/c/:category', (req, res) => {
      const category = req.params.category;
      const page = pageNumber(req.query.page);
      if (!isCategoryKey(category) || page === null) {
        sendNotFound(STORE_ID, req, res, ctx);
        return;
      }
      const all = categoryListings(STORE_ID, category);
      const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      if (page > pages) {
        sendNotFound(STORE_ID, req, res, ctx);
        return;
      }
      const c = classes();
      const root = rootOf(req);
      const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      sendHtml(
        res,
        200,
        layout({
          storeName: name,
          title: CATEGORY_NAMES_VI[category],
          root,
          accent: ACCENTS[STORE_ID],
          saleBanner: saleBanner(ctx),
          head: script(root),
          bodyAttributes: shellAttributes(root),
          body: `<h1>${CATEGORY_NAMES_VI[category]}</h1>
<div class="${c.grid} grid">
${items.map((l) => itemHtml(c, l, root, 'article')).join('\n')}
</div>
${pagerHtml(category, page, pages, c.next)}`,
        }),
      );
    });

    router.get('/p/:slug', (req, res) => {
      const listing = listingBySlug(STORE_ID, req.params.slug);
      if (!listing) {
        sendNotFound(STORE_ID, req, res, ctx);
        return;
      }
      const root = rootOf(req);
      sendHtml(
        res,
        200,
        layout({
          storeName: name,
          title: listing.title,
          root,
          accent: ACCENTS[STORE_ID],
          saleBanner: saleBanner(ctx),
          head: script(root),
          bodyAttributes: shellAttributes(root),
          body: `<nav class="breadcrumb"><a href="${root}c/${listing.category}">${CATEGORY_NAMES_VI[listing.category]}</a></nav>
${itemHtml(classes(), listing, root, 'h1')}`,
        }),
      );
    });
  });
}
