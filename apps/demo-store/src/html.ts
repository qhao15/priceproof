/** Banner shown on every page of the demo stores: they must always be labeled as simulated. */
export const DEMO_BANNER_TEXT = 'Demo store – simulated prices';
export const DEMO_BANNER_TEXT_VI = 'Cửa hàng demo – giá mô phỏng';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Formats integer VND the way Vietnamese stores do: "12.990.000₫". */
export function formatVnd(vnd: number): string {
  return `${String(vnd).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}₫`;
}

/** JSON for a `<script>` element: `<` is escaped so the text can never close the element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export interface LayoutOptions {
  storeName: string;
  title: string;
  /** Relative path from the current page to the site root, for example "" or "../". */
  root: string;
  body: string;
  /** Text of the running sale event, if any. */
  saleBanner?: string | null;
  head?: string;
  bodyAttributes?: string;
  accent: string;
}

export function layout(o: LayoutOptions): string {
  const sale = o.saleBanner ? `<div class="sale-banner">${escapeHtml(o.saleBanner)}</div>` : '';
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)} | ${escapeHtml(o.storeName)}</title>
<style>
:root { --accent: ${o.accent}; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #1d2330; }
a { color: inherit; }
.demo-banner { background: #1d2330; color: #fff; text-align: center; padding: 6px 12px; font-size: 14px; }
.sale-banner { background: var(--accent); color: #fff; text-align: center; padding: 6px; font-weight: 600; }
header.site { background: #fff; border-bottom: 1px solid #e3e6eb; padding: 12px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
header.site .logo { font-weight: 800; font-size: 20px; color: var(--accent); text-decoration: none; }
header.site nav a { margin-right: 12px; text-decoration: none; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
ul.grid, div.grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.card { background: #fff; border: 1px solid #e3e6eb; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.card a { text-decoration: none; font-weight: 600; }
.now { color: var(--accent); font-weight: 700; font-size: 18px; }
.was { color: #6b7280; }
.badge { background: var(--accent); color: #fff; border-radius: 4px; padding: 0 4px; font-size: 12px; }
.oos { color: #b42318; }
.pager { margin: 16px 0; display: flex; gap: 16px; align-items: center; }
footer { text-align: center; color: #6b7280; font-size: 13px; padding: 24px 16px; }
</style>
${o.head ?? ''}
</head>
<body${o.bodyAttributes ? ` ${o.bodyAttributes}` : ''}>
<div class="demo-banner" role="note">${DEMO_BANNER_TEXT} · ${DEMO_BANNER_TEXT_VI}</div>
${sale}
<header class="site">
<a class="logo" href="${o.root || './'}">${escapeHtml(o.storeName)}</a>
<nav>
<a href="${o.root}c/phone">Điện thoại</a>
<a href="${o.root}c/laptop">Laptop</a>
<a href="${o.root}c/headphones">Tai nghe</a>
<a href="${o.root}cart">Giỏ hàng</a>
</nav>
</header>
<main>
${o.body}
</main>
<footer>${escapeHtml(o.storeName)} is a fictional store. ${DEMO_BANNER_TEXT}.</footer>
</body>
</html>
`;
}
