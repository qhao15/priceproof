import { isCategoryKey } from '@priceproof/shared';
import type { Express } from 'express';
import {
  COLOR_NAMES_VI,
  DEMO_STORE_NAMES,
  type DemoListing,
  getCatalog,
  listingVariant,
} from '../catalog.js';
import { escapeHtml, formatVnd, layout, scriptJson } from '../html.js';
import { type DemoPrice, priceAt } from '../prices.js';
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
 * DemoMart (SPEC §14.1): server-rendered HTML, fetched with plain HTTP. Product pages also
 * carry JSON-LD `Product` / `Offer`.
 */

const STORE_ID = 'demomart';

/** CSS classes of the normal layout, and the renamed ones of `DEMO_FAULTS=layoutV2`. */
const CLASSES = {
  v1: {
    list: 'product-list',
    card: 'product-card',
    title: 'product-title',
    price: 'price',
    listPrice: 'list-price',
    stock: 'stock',
    next: 'next-page',
    name: 'product-name',
  },
  v2: {
    list: 'catalog-v2',
    card: 'tile-v2',
    title: 'tile-heading',
    price: 'amount-now',
    listPrice: 'amount-was',
    stock: 'availability',
    next: 'pager-forward',
    name: 'detail-heading',
  },
};
type Classes = (typeof CLASSES)['v1'];

function priceHtml(c: Classes, p: DemoPrice): string {
  if (p.price === null) {
    return `<span class="${c.price} now price-contact">Liên hệ</span>`;
  }
  let html = `<span class="${c.price} now">${formatVnd(p.price)}</span>`;
  if (p.listPrice !== null) {
    const pct = Math.round(((p.listPrice - p.price) / p.listPrice) * 100);
    html += ` <del class="${c.listPrice} was">${formatVnd(p.listPrice)}</del> <span class="badge">-${pct}%</span>`;
  }
  return html;
}

function stockHtml(c: Classes, p: DemoPrice): string {
  return p.inStock
    ? `<span class="${c.stock} in-stock">Còn hàng</span>`
    : `<span class="${c.stock} out-of-stock oos">Hết hàng</span>`;
}

function card(c: Classes, l: DemoListing, now: Date): string {
  const p = priceAt(l.productId, STORE_ID, now);
  return `<li class="${c.card} card" data-product-id="${l.storeProductId}">
<a class="${c.title}" href="../p/${l.slug}">${escapeHtml(l.title)}</a>
<div class="price-box">${priceHtml(c, p)}</div>
${stockHtml(c, p)}
</li>`;
}

function jsonLd(l: DemoListing, p: DemoPrice): string {
  const product = getCatalog().productById.get(l.productId)!;
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    priceCurrency: 'VND',
    availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
  };
  if (p.price !== null) {
    offer.price = p.price;
  }
  if (p.listPrice !== null) {
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      priceType: 'https://schema.org/ListPrice',
      price: p.listPrice,
      priceCurrency: 'VND',
    };
  }
  return scriptJson({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: l.title,
    sku: l.storeProductId,
    category: CATEGORY_NAMES_VI[l.category],
    brand: { '@type': 'Brand', name: product.brand },
    offers: offer,
  });
}

function specsHtml(l: DemoListing): string {
  const v = listingVariant(l);
  const rows: [string, string][] = [];
  if (v.ramGb) rows.push(['RAM', `${v.ramGb} GB`]);
  if (v.storageGb)
    rows.push(['Bộ nhớ', v.storageGb >= 1024 ? `${v.storageGb / 1024} TB` : `${v.storageGb} GB`]);
  if (v.color) rows.push(['Màu sắc', COLOR_NAMES_VI[v.color]]);
  if (rows.length === 0) {
    return '';
  }
  return `<dl class="specs">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${escapeHtml(val)}</dd>`).join('')}</dl>`;
}

export function createDemoMartApp(ctx: StoreContext): Express {
  const classes = () => (ctx.faults.has('layoutV2') ? CLASSES.v2 : CLASSES.v1);
  const name = DEMO_STORE_NAMES[STORE_ID];
  return createStoreApp(STORE_ID, ctx, (router) => {
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
          body: homeBody(STORE_ID, 'Điện thoại, laptop và tai nghe của các thương hiệu hư cấu.'),
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
      const now = ctx.clock.now();
      const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      sendHtml(
        res,
        200,
        layout({
          storeName: name,
          title: CATEGORY_NAMES_VI[category],
          root: rootOf(req),
          accent: ACCENTS[STORE_ID],
          saleBanner: saleBanner(ctx),
          body: `<h1>${CATEGORY_NAMES_VI[category]}</h1>
<ul class="${c.list} grid">
${items.map((l) => card(c, l, now)).join('\n')}
</ul>
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
      const c = classes();
      const p = priceAt(listing.productId, STORE_ID, ctx.clock.now());
      sendHtml(
        res,
        200,
        layout({
          storeName: name,
          title: listing.title,
          root: rootOf(req),
          accent: ACCENTS[STORE_ID],
          saleBanner: saleBanner(ctx),
          head: `<script type="application/ld+json">${jsonLd(listing, p)}</script>`,
          body: `<nav class="breadcrumb"><a href="../c/${listing.category}">${CATEGORY_NAMES_VI[listing.category]}</a></nav>
<article class="product-detail card" data-product-id="${listing.storeProductId}">
<h1 class="${c.name}">${escapeHtml(listing.title)}</h1>
<div class="price-box">${priceHtml(c, p)}</div>
${stockHtml(c, p)}
${specsHtml(listing)}
<p>Bảo hành 12 tháng. Trả góp 0%.</p>
</article>`,
        }),
      );
    });
  });
}
