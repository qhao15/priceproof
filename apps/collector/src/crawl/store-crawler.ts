import { randomUUID } from 'node:crypto';
import {
  type BasicCrawler,
  CheerioCrawler,
  Configuration,
  log as crawleeLog,
  RequestQueue,
} from '@crawlee/cheerio';
import { PlaywrightCrawler } from '@crawlee/playwright';
import type { CategoryKey } from '@priceproof/shared';
import type { Logger } from 'pino';
import { chromium } from 'playwright';
import type { StoreAdapter } from '../stores/types.js';
import type { RateGate } from './rate-gate.js';

/** Crawlee options from SPEC §9.3. */
export const MAX_REQUEST_RETRIES = 2;
export const REQUEST_HANDLER_TIMEOUT_SECS = 60;
export const NAVIGATION_TIMEOUT_SECS = 30;
export const READY_SELECTOR_TIMEOUT_MS = 15_000;
/** Browser stores: only documents, scripts and XHR/fetch are loaded. */
const BLOCKED_RESOURCES = new Set(['image', 'font', 'media', 'stylesheet']);

crawleeLog.setLevel(crawleeLog.LEVELS.WARNING);

export interface CrawlRequestData {
  label: 'CATEGORY' | 'PRODUCT';
  runId?: string;
  categoryKey?: CategoryKey;
  page?: number;
  listingId?: string;
  commandId?: string;
}

export interface FetchedPage {
  html: string;
  status: number;
  /** URL that was fetched (after redirects). */
  url: string;
}

/** Thrown by `onPage` for errors Crawlee should retry (5xx, timeouts). */
export class RetryableError extends Error {}

export interface StoreCrawlerOptions {
  storeId: string;
  adapter: StoreAdapter;
  userAgent: string;
  requestsPerMinute: number;
  /** Shared with robots.txt fetches of the same store, so every request counts. */
  gate: RateGate;
  logger: Logger;
  /** Called before every attempt (including retries), after the rate gate. */
  onAttempt: () => Promise<void> | void;
  /** Handles a fetched page. Throw `RetryableError` to have Crawlee retry. */
  onPage: (data: CrawlRequestData, page: FetchedPage) => Promise<void>;
  /** Called once a request failed after all retries. */
  onFailed: (data: CrawlRequestData, url: string, error: Error) => Promise<void>;
}

export interface EnqueueRequest {
  /** URL to fetch (already mapped with `adapter.toFetchUrl`). */
  url: string;
  data: CrawlRequestData;
  forefront?: boolean;
}

type AnyCrawler = BasicCrawler<never>;

/**
 * One Crawlee crawler for one store (SPEC §9.3): its own named in-memory queue, one request at a
 * time, the store's rate, the honest user agent and no browser fingerprints.
 */
export class StoreCrawler {
  private crawler: CheerioCrawler | PlaywrightCrawler | null = null;
  private queue: RequestQueue | null = null;
  private running: Promise<unknown> | null = null;
  private inFlight = 0;
  private queued = 0;
  private stopped = false;

  constructor(private readonly o: StoreCrawlerOptions) {}

  get storeId(): string {
    return this.o.storeId;
  }

  get rate(): number {
    return this.o.requestsPerMinute;
  }

  /** Requests queued or being processed. */
  pending(): number {
    return this.queued + this.inFlight;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  async start(): Promise<void> {
    const config = new Configuration({ persistStorage: false, purgeOnStart: true });
    this.queue = await RequestQueue.open(`store-${this.o.storeId}-${randomUUID()}`, { config });
    this.crawler =
      this.o.adapter.fetchMethod === 'browser'
        ? this.browserCrawler(config)
        : this.httpCrawler(config);
    this.running = this.crawler.run().catch((error: unknown) => {
      this.o.logger.error({ err: error, storeId: this.o.storeId }, 'crawler stopped with an error');
    });
  }

  async add(requests: EnqueueRequest[]): Promise<void> {
    if (!this.crawler || this.stopped || requests.length === 0) return;
    this.queued += requests.length;
    await this.crawler.addRequests(
      requests.map((r) => ({
        url: r.url,
        userData: r.data,
        // Unique per request, or Crawlee silently drops repeat checks of the same URL.
        uniqueKey: `${r.data.label}:${r.data.listingId ?? r.url}:${Date.now()}:${randomUUID()}`,
      })),
      { forefront: requests.some((r) => r.forefront) },
    );
  }

  /** Stops the crawler: queued requests are dropped, the in-flight one may finish (max 30 s). */
  async stop(timeoutMs = 30_000): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.crawler?.stop('collector stopping');
    const done = this.running ?? Promise.resolve();
    await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    if (this.crawler instanceof PlaywrightCrawler) {
      await this.crawler.browserPool.destroy().catch(() => undefined);
    }
    await this.queue?.drop().catch(() => undefined);
    this.queued = 0;
  }

  private async attempt(): Promise<void> {
    await this.o.gate.wait();
    await this.o.onAttempt();
  }

  private async handle(data: CrawlRequestData, page: FetchedPage): Promise<void> {
    if (this.stopped) return;
    await this.o.onPage(data, page);
  }

  private common() {
    return {
      requestQueue: this.queue!,
      maxConcurrency: 1,
      maxRequestsPerMinute: this.o.requestsPerMinute,
      maxRequestRetries: MAX_REQUEST_RETRIES,
      requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
      navigationTimeoutSecs: NAVIGATION_TIMEOUT_SECS,
      keepAlive: true,
      // No session rotation: 403/429 reach the handler, which pauses the store (no retries).
      useSessionPool: false,
      persistCookiesPerSession: false,
      failedRequestHandler: async (
        { request }: { request: { userData: unknown; url: string } },
        error: Error,
      ) => {
        this.done();
        if (this.stopped) return;
        await this.o.onFailed(request.userData as CrawlRequestData, request.url, error);
      },
    };
  }

  /** Bookkeeping: a request left the queue for good. */
  private done(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  private begin(retryCount: number): void {
    if (retryCount === 0) {
      this.queued = Math.max(0, this.queued - 1);
      this.inFlight++;
    }
  }

  private httpCrawler(config: Configuration): CheerioCrawler {
    return new CheerioCrawler(
      {
        ...this.common(),
        additionalMimeTypes: ['text/plain', 'application/json'],
        preNavigationHooks: [
          async ({ request }, gotOptions) => {
            this.begin(request.retryCount);
            await this.attempt();
            // Honest identity: our user agent only, no generated browser headers.
            gotOptions.headerGeneratorOptions = undefined;
            gotOptions.useHeaderGenerator = false;
            gotOptions.headers = {
              'user-agent': this.o.userAgent,
              accept: 'text/html,application/xhtml+xml',
            };
          },
        ],
        requestHandler: async ({ request, response, body }) => {
          try {
            await this.handle(request.userData as CrawlRequestData, {
              html: typeof body === 'string' ? body : body.toString('utf8'),
              status: response.statusCode ?? 0,
              url: request.loadedUrl ?? request.url,
            });
          } catch (error) {
            if (!(error instanceof RetryableError)) request.noRetry = true;
            throw error;
          }
          this.done();
        },
      },
      config,
    );
  }

  private browserCrawler(config: Configuration): PlaywrightCrawler {
    const ready = this.o.adapter.readySelector;
    return new PlaywrightCrawler(
      {
        ...this.common(),
        headless: true,
        launchContext: {
          launcher: chromium,
          userAgent: this.o.userAgent,
          launchOptions: { headless: true },
        },
        browserPoolOptions: { useFingerprints: false },
        preNavigationHooks: [
          async ({ request, page }) => {
            this.begin(request.retryCount);
            await this.attempt();
            await page.route('**/*', (route) =>
              BLOCKED_RESOURCES.has(route.request().resourceType())
                ? route.abort()
                : route.continue(),
            );
          },
        ],
        requestHandler: async ({ request, response, page }) => {
          const status = response?.status() ?? 0;
          if (ready && status > 0 && status < 400) {
            // If it never appears, the adapter reports the page as not loaded.
            await page
              .waitForSelector(ready, { timeout: READY_SELECTOR_TIMEOUT_MS, state: 'attached' })
              .catch(() => undefined);
          }
          try {
            await this.handle(request.userData as CrawlRequestData, {
              html: await page.content(),
              status,
              url: request.loadedUrl ?? request.url,
            });
          } catch (error) {
            if (!(error instanceof RetryableError)) request.noRetry = true;
            throw error;
          }
          this.done();
        },
      },
      config,
    );
  }
}

export type { AnyCrawler };
