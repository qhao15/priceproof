import { type CategoryKey, saleEventAt } from '@priceproof/shared';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import type { Logger } from 'pino';
import { DEMO_STORE_NAMES, type DemoListing, type DemoStoreId, getCatalog } from '../catalog.js';
import type { DemoClock } from '../clock.js';
import type { DemoFault } from '../env.js';
import { escapeHtml, layout } from '../html.js';
import { getTruth } from '../truth.js';

export interface StoreContext {
  clock: DemoClock;
  faults: ReadonlySet<DemoFault>;
  /** Random source for `errors5pct`. Default `Math.random`. */
  random: () => number;
  logger: Logger;
}

export const PAGE_SIZE = 24;
export const ERROR_RATE = 0.05;

export const CATEGORY_NAMES_VI: Record<CategoryKey, string> = {
  phone: 'Điện thoại',
  laptop: 'Laptop',
  headphones: 'Tai nghe',
};

export const ACCENTS: Record<DemoStoreId, string> = {
  demomart: '#c2410c',
  shopjs: '#4338ca',
};

/** Relative path from the requested page to the site root ("", "../", …). */
export function rootOf(req: Request): string {
  return '../'.repeat(Math.max(0, req.path.split('/').length - 2));
}

export function saleBanner(ctx: StoreContext): string | null {
  const event = saleEventAt(ctx.clock.now());
  return event ? `Siêu sale ${event.name} đang diễn ra` : null;
}

export function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type('html').set('Cache-Control', 'no-store').send(html);
}

/** Listings of a store in one category, in catalog order. */
export function categoryListings(storeId: DemoStoreId, category: CategoryKey): DemoListing[] {
  return getCatalog().listingsByStore[storeId].filter((l) => l.category === category);
}

export function listingBySlug(storeId: DemoStoreId, slug: string): DemoListing | undefined {
  return getCatalog().listingsByStore[storeId].find((l) => l.slug === slug);
}

export function pageNumber(raw: unknown): number | null {
  if (raw === undefined) {
    return 1;
  }
  if (typeof raw !== 'string' || !/^[1-9]\d{0,3}$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

export function pagerHtml(
  category: CategoryKey,
  page: number,
  pages: number,
  nextClass: string,
): string {
  const prev =
    page > 1 ? `<a class="prev-page" href="${category}?page=${page - 1}">‹ Trang trước</a>` : '';
  const next =
    page < pages
      ? `<a class="${nextClass}" rel="next" href="${category}?page=${page + 1}">Trang sau ›</a>`
      : '';
  return `<nav class="pager">${prev}<span>Trang ${page}/${pages}</span>${next}</nav>`;
}

function notFoundPage(storeId: DemoStoreId, req: Request, ctx: StoreContext): string {
  return layout({
    storeName: DEMO_STORE_NAMES[storeId],
    title: 'Không tìm thấy trang',
    root: rootOf(req),
    accent: ACCENTS[storeId],
    saleBanner: saleBanner(ctx),
    body: `<h1 class="not-found">404 – Không tìm thấy trang</h1>
<p>Trang bạn tìm không tồn tại hoặc sản phẩm đã ngừng kinh doanh.</p>`,
  });
}

export function sendNotFound(
  storeId: DemoStoreId,
  req: Request,
  res: Response,
  ctx: StoreContext,
): void {
  sendHtml(res, 404, notFoundPage(storeId, req, ctx));
}

const CAPTCHA_HTML = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>Xác minh bảo mật</title></head>
<body>
<div class="demo-banner" role="note">Demo store – simulated prices</div>
<div id="captcha" class="captcha-challenge">
<h1>Vui lòng xác minh bạn không phải là robot</h1>
<p>Please complete the CAPTCHA to continue.</p>
<form><label><input type="checkbox" name="captcha"> Tôi không phải là robot</label></form>
</div>
</body>
</html>
`;

/**
 * Creates an Express app with the parts both stores share: request logging, the ground-truth
 * endpoint, fault injection, robots.txt and the cart page. `routes` adds the store's own pages;
 * unknown paths get the 404 page.
 */
export function createStoreApp(
  storeId: DemoStoreId,
  ctx: StoreContext,
  routes: (router: Router) => void,
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      ctx.logger.debug(
        {
          store: storeId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
        },
        'request',
      );
    });
    next();
  });

  // Test controls are never affected by faults.
  app.get('/__demo/truth', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(getTruth());
  });

  app.use((req, res, next) => {
    if (ctx.faults.has('block429')) {
      res.status(429).set('Retry-After', '3600').type('text').send('Too Many Requests');
      return;
    }
    if (ctx.faults.has('captcha') && req.path !== '/robots.txt') {
      sendHtml(res, 200, CAPTCHA_HTML);
      return;
    }
    if (ctx.faults.has('errors5pct') && ctx.random() < ERROR_RATE) {
      res.status(500).type('text').send('Internal Server Error');
      return;
    }
    next();
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text').send('User-agent: *\nDisallow: /cart\n');
  });

  app.get('/cart', (req, res) => {
    sendHtml(
      res,
      200,
      layout({
        storeName: DEMO_STORE_NAMES[storeId],
        title: 'Giỏ hàng',
        root: rootOf(req),
        accent: ACCENTS[storeId],
        saleBanner: saleBanner(ctx),
        body: '<h1>Giỏ hàng</h1><p>Giỏ hàng của bạn đang trống. Đây là cửa hàng demo, không bán hàng thật.</p>',
      }),
    );
  });

  const router = express.Router();
  routes(router);
  app.use(router);

  app.use((req, res) => sendNotFound(storeId, req, res, ctx));

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    ctx.logger.error({ err: error, store: storeId, url: req.originalUrl }, 'request failed');
    if (!res.headersSent) {
      res.status(500).type('text').send('Internal Server Error');
    }
  });

  return app;
}

export function homeBody(storeId: DemoStoreId, intro: string): string {
  const counts = (['phone', 'laptop', 'headphones'] as const)
    .map(
      (c) =>
        `<li class="card"><a href="c/${c}">${CATEGORY_NAMES_VI[c]}</a><span>${categoryListings(storeId, c).length} sản phẩm</span></li>`,
    )
    .join('\n');
  return `<h1>${escapeHtml(DEMO_STORE_NAMES[storeId])}</h1>
<p>${escapeHtml(intro)}</p>
<ul class="grid">
${counts}
</ul>`;
}
