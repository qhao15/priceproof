import { type Browser, chromium } from 'playwright';
import type { StoreAdapter } from '../stores/types.js';
import type { FetchedPage } from './store-crawler.js';

const BLOCKED_RESOURCES = new Set(['image', 'font', 'media', 'stylesheet']);

/**
 * Fetches one page outside Crawlee, for CLI tools such as `scrape:dry`: plain HTTP for `http`
 * stores, headless Chromium for `browser` stores. Same honest identity as the crawler.
 */
export class PageFetcher {
  private browser: Browser | null = null;

  constructor(
    private readonly adapter: StoreAdapter,
    private readonly userAgent: string,
  ) {}

  async fetch(url: string): Promise<FetchedPage> {
    if (this.adapter.fetchMethod === 'http') {
      const res = await fetch(url, {
        headers: { 'user-agent': this.userAgent, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30_000),
      });
      return { html: await res.text(), status: res.status, url: res.url || url };
    }
    this.browser ??= await chromium.launch({ headless: true });
    const context = await this.browser.newContext({ userAgent: this.userAgent });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) =>
        BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      const response = await page.goto(url, { timeout: 30_000 });
      const status = response?.status() ?? 0;
      if (this.adapter.readySelector && status < 400) {
        await page
          .waitForSelector(this.adapter.readySelector, { timeout: 15_000, state: 'attached' })
          .catch(() => undefined);
      }
      return { html: await page.content(), status, url: page.url() };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
