import { setTimeout as sleep } from 'node:timers/promises';
import {
  BOOST_CRAWL_EVERY_MINUTES,
  CATEGORY_LEASE_MS,
  type CategoryKey,
  checkIntervalMinutes,
  failureDelayMinutes,
  LISTING_LEASE_MS,
  NOT_FOUND_LIMIT,
  type PauseReason,
  type ScrapeRunOutcome,
  type StoreCategory,
  type StoreDoc,
} from '@priceproof/shared';
import { Cron } from 'croner';
import { ObjectId } from 'mongodb';
import { processCommands } from '../commands/processor.js';
import type { CollectorContext } from '../context.js';
import { acquireLock, LOCK_RENEW_MS, releaseLock } from '../crawl/lock.js';
import { RateGate } from '../crawl/rate-gate.js';
import { effectiveRate, fetchRobots, type RobotsRules } from '../crawl/robots.js';
import {
  type CrawlRequestData,
  type FetchedPage,
  RetryableError,
  StoreCrawler,
} from '../crawl/store-crawler.js';
import { incHourly } from '../health/hourly-stats.js';
import { isActiveStore, pauseStore, runHealthMonitor } from '../health/monitor.js';
import { saveErrorSnapshot } from '../health/snapshots.js';
import { refreshStatsIfDue, syncPriorities, sweepLeases } from '../jobs/maintenance.js';
import { processObservation } from '../processing/observation.js';
import { inBoostWindow } from '../processing/stats.js';
import type { StoreAdapter } from '../stores/types.js';

/** Job intervals (SPEC §9.1). Tests shorten them. */
export interface Timings {
  schedulerMs: number;
  commandsMs: number;
  healthMs: number;
  sweeperMs: number;
  prioritySyncMs: number;
  lockRenewMs: number;
  /** Once mode exits when nothing has been due for this long. */
  idleExitMs: number;
  /** In-flight requests may finish for at most this long when stopping. */
  drainMs: number;
  robotsRefreshMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  schedulerMs: 30_000,
  commandsMs: 5_000,
  healthMs: 5 * 60_000,
  sweeperMs: 60_000,
  prioritySyncMs: 10 * 60_000,
  lockRenewMs: LOCK_RENEW_MS,
  idleExitMs: 60_000,
  drainMs: 30_000,
  robotsRefreshMs: 24 * 60 * 60_000,
};

/** Category crawls stop after this many pages (SPEC §9.4). */
export const MAX_CATEGORY_PAGES = 30;
/** Claim listing checks when a store has fewer pending requests than this. */
export const LISTING_QUEUE_LOW = 10;
/** Demo categories are crawled at least this often when demo time runs faster. */
export const FAST_DEMO_CRAWL_MINUTES = 10;

export interface CollectorOptions {
  ctx: CollectorContext;
  adapters: Map<string, StoreAdapter>;
  userAgent: string;
  mode: 'once' | 'daemon';
  /** Lock owner: GitHub run ID, or hostname + process ID. */
  owner: string;
  demoTimeScale?: number;
  timings?: Partial<Timings>;
  fetchImpl?: typeof fetch;
}

interface RunState {
  id: ObjectId;
  storeId: string;
  categoryKey: CategoryKey;
  pending: number;
  pages: number;
  itemsSeen: number;
  newListings: number;
  priceChanges: number;
  suspicious: number;
  itemsWithoutPrice: number;
  skippedUsed: number;
  errors: number;
  blocked: boolean;
  errorSamples: string[];
}

export type StartResult = 'started' | 'locked';

/**
 * The collector process (SPEC §9.1): daemon mode keeps running; once mode runs for a time
 * budget and exits. A MongoDB lock makes sure only one collector crawls at a time.
 */
export class Collector {
  private readonly ctx: CollectorContext;
  private readonly t: Timings;
  private readonly crawlers = new Map<string, StoreCrawler>();
  private readonly robots = new Map<string, { rules: RobotsRules; fetchedAt: number }>();
  /** One rate gate per store, shared by robots.txt and page requests. */
  private readonly gates = new Map<string, RateGate>();
  private readonly runs = new Map<string, RunState>();
  private readonly claimed = new Map<string, string>(); // listingId → storeId
  private readonly timers: NodeJS.Timeout[] = [];
  private cron: Cron | null = null;
  private lastActivity = Date.now();
  private stopping = false;
  private ticking: Promise<void> | null = null;
  private lockLost = false;

  constructor(private readonly o: CollectorOptions) {
    this.ctx = o.ctx;
    this.t = { ...DEFAULT_TIMINGS, ...o.timings };
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  async start(): Promise<StartResult> {
    if (!(await acquireLock(this.ctx, this.o.owner))) {
      this.ctx.logger.info({ owner: this.o.owner }, 'another collector holds the lock; exiting');
      return 'locked';
    }
    await this.ctx.col.systemState.updateOne(
      { _id: 'collector' },
      { $set: { lastRunMode: this.o.mode, lastRunStartedAt: this.ctx.clock() } },
    );
    await sweepLeases(this.ctx);
    await syncPriorities(this.ctx);
    await this.syncStores();

    this.every(this.t.lockRenewMs, () => this.renewLock());
    this.every(this.t.commandsMs, () => this.runCommands());
    this.every(this.t.schedulerMs, () => this.tick());
    this.every(this.t.healthMs, () => runHealthMonitor(this.ctx, (id, r) => this.onPaused(id, r)));
    if (this.o.mode === 'daemon') {
      this.every(this.t.sweeperMs, () => sweepLeases(this.ctx));
      this.every(this.t.prioritySyncMs, () => syncPriorities(this.ctx).then(() => undefined));
      this.cron = new Cron('0 3 * * *', { timezone: 'Asia/Ho_Chi_Minh' }, () => {
        void refreshStatsIfDue(this.ctx).catch((err: unknown) =>
          this.ctx.logger.error({ err }, 'daily stats refresh failed'),
        );
      });
    }
    await this.runCommands();
    await this.tick();
    this.ctx.logger.info(
      { mode: this.o.mode, stores: [...this.crawlers.keys()] },
      'collector started',
    );
    return 'started';
  }

  /**
   * Once mode (SPEC §9.1): runs until the time budget is used or nothing has been due for 60
   * seconds, then shuts down cleanly.
   */
  async runOnce(minutes: number): Promise<StartResult> {
    const deadline = Date.now() + minutes * 60_000;
    const started = await this.start();
    if (started === 'locked') return started;
    while (!this.stopping && !this.lockLost && Date.now() < deadline) {
      if (this.isIdle() && Date.now() - this.lastActivity >= this.t.idleExitMs) {
        this.ctx.logger.info('nothing due; ending the run early');
        break;
      }
      await sleep(500);
    }
    await this.shutdown();
    return 'started';
  }

  /** Stops scheduling, lets in-flight requests finish, releases leases and the lock. */
  async shutdown(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.cron?.stop();
    await this.ticking?.catch(() => undefined);
    await Promise.all([...this.crawlers.values()].map((c) => c.stop(this.t.drainMs)));
    this.crawlers.clear();
    await this.releaseUnprocessed();
    try {
      await runHealthMonitor(this.ctx);
      if (this.o.mode === 'once') await refreshStatsIfDue(this.ctx);
    } finally {
      await this.ctx.col.systemState.updateOne(
        { _id: 'collector' },
        { $set: { lastRunFinishedAt: this.ctx.clock() } },
      );
      await releaseLock(this.ctx, this.o.owner);
      this.ctx.logger.info('collector stopped');
    }
  }

  private every(ms: number, job: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      if (this.stopping) return;
      job().catch((err: unknown) => this.ctx.logger.error({ err }, 'collector job failed'));
    }, ms);
    this.timers.push(timer);
  }

  private async renewLock(): Promise<void> {
    if (!(await acquireLock(this.ctx, this.o.owner))) {
      this.ctx.logger.error('lost the collector lock; stopping');
      this.lockLost = true;
      void this.shutdown();
    }
  }

  private isIdle(): boolean {
    return this.runs.size === 0 && [...this.crawlers.values()].every((c) => c.pending() === 0);
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private async runCommands(): Promise<void> {
    const n = await processCommands(this.ctx, {
      onStoreResumed: async (storeId) => {
        await this.stopCrawler(storeId);
      },
      onWorkDue: () => {
        void this.tick();
      },
    });
    if (n > 0) this.touch();
  }

  // ------------------------------------------------------------------------------------------
  // Stores and crawlers
  // ------------------------------------------------------------------------------------------

  /** Starts or stops crawlers to match the stores in MongoDB (enabled, paused, resumed, rate). */
  private async syncStores(): Promise<void> {
    const stores = await this.ctx.col.stores.find({ enabled: true }).toArray();
    const active = new Set<string>();
    for (const store of stores) {
      const adapter = this.o.adapters.get(store._id);
      if (!adapter || !isActiveStore(store)) continue;
      const rules = await this.robotsFor(store, adapter);
      if (!rules) continue;
      const startUrls = store.categories.flatMap((c) => c.startUrls).map(adapter.toFetchUrl);
      if (startUrls.some((u) => !rules.isAllowed(u))) {
        await this.pause(store._id, 'robots_disallowed');
        continue;
      }
      active.add(store._id);
      const rate = effectiveRate(store.rateLimit.requestsPerMinute, rules.crawlDelaySeconds);
      const existing = this.crawlers.get(store._id);
      if (existing && existing.rate !== rate) await this.stopCrawler(store._id);
      if (!this.crawlers.has(store._id)) await this.startCrawler(store, adapter, rate);
    }
    for (const id of [...this.crawlers.keys()]) {
      if (!active.has(id)) await this.stopCrawler(id);
    }
  }

  private async robotsFor(store: StoreDoc, adapter: StoreAdapter): Promise<RobotsRules | null> {
    const cached = this.robots.get(store._id);
    if (cached && Date.now() - cached.fetchedAt < this.t.robotsRefreshMs) return cached.rules;
    const origin = new URL(adapter.toFetchUrl(store.baseUrl)).origin;
    await this.gateFor(store._id, store.rateLimit.requestsPerMinute).wait();
    await incHourly(this.ctx, store._id, { requests: 1 });
    const result = await fetchRobots(origin, this.o.userAgent, this.o.fetchImpl);
    if (result.ok) {
      await incHourly(this.ctx, store._id, { successes: 1 });
      this.robots.set(store._id, { rules: result.rules, fetchedAt: Date.now() });
      return result.rules;
    }
    if (result.blocked) {
      await incHourly(this.ctx, store._id, { blocked: 1 });
      await saveErrorSnapshot(this.ctx, {
        storeId: store._id,
        url: `${origin}/robots.txt`,
        kind: 'blocked',
        httpStatus: result.status,
        message: result.reason,
      });
      await this.pause(store._id, 'blocked');
    } else {
      await incHourly(this.ctx, store._id, { failures: 1 });
      this.ctx.logger.warn(
        { storeId: store._id, reason: result.reason },
        'robots.txt unavailable; store skipped for now',
      );
    }
    return null;
  }

  private gateFor(storeId: string, rate: number): RateGate {
    let gate = this.gates.get(storeId);
    if (!gate || gate.requestsPerMinute !== rate) {
      gate = new RateGate(rate, Date.now, gate);
      this.gates.set(storeId, gate);
    }
    return gate;
  }

  private async startCrawler(store: StoreDoc, adapter: StoreAdapter, rate: number): Promise<void> {
    const storeId = store._id;
    const crawler = new StoreCrawler({
      storeId,
      adapter,
      userAgent: this.o.userAgent,
      requestsPerMinute: rate,
      gate: this.gateFor(storeId, rate),
      logger: this.ctx.logger,
      onAttempt: () => incHourly(this.ctx, storeId, { requests: 1 }),
      onPage: (data, page) => this.onPage(storeId, adapter, data, page),
      onFailed: (data, url, error) => this.onFailed(storeId, data, url, error),
    });
    await crawler.start();
    this.crawlers.set(storeId, crawler);
    this.ctx.logger.info({ storeId, rate, fetchMethod: adapter.fetchMethod }, 'crawler started');
  }

  private async stopCrawler(storeId: string): Promise<void> {
    const crawler = this.crawlers.get(storeId);
    if (!crawler) return;
    this.crawlers.delete(storeId);
    await crawler.stop(this.t.drainMs);
    await this.releaseUnprocessed(storeId);
  }

  private async pause(storeId: string, reason: PauseReason): Promise<void> {
    await pauseStore(this.ctx, storeId, reason, (id, r) => this.onPaused(id, r));
  }

  /** After a pause: stop the crawler and drop its queue. Never awaited inside a page handler. */
  private onPaused(storeId: string, _reason: PauseReason): void {
    const crawler = this.crawlers.get(storeId);
    if (!crawler) return;
    this.crawlers.delete(storeId);
    void crawler
      .stop(this.t.drainMs)
      .then(() => this.releaseUnprocessed(storeId))
      .catch((err: unknown) => this.ctx.logger.error({ err, storeId }, 'stopping crawler failed'));
  }

  /** Releases listing leases and finalizes category runs that will not be processed. */
  private async releaseUnprocessed(storeId?: string): Promise<void> {
    const ids = [...this.claimed.entries()]
      .filter(([, s]) => !storeId || s === storeId)
      .map(([id]) => id);
    for (const id of ids) this.claimed.delete(id);
    if (ids.length > 0) {
      await this.ctx.col.listings.updateMany(
        { _id: { $in: ids.map((id) => new ObjectId(id)) } },
        { $set: { 'schedule.leaseUntil': null } },
      );
    }
    for (const run of [...this.runs.values()]) {
      if (!storeId || run.storeId === storeId) await this.finalizeRun(run, true);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Scheduler (SPEC §9.4)
  // ------------------------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.stopping) return;
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      await this.syncStores();
      for (const [storeId, crawler] of this.crawlers) {
        if (this.stopping) break;
        const store = await this.ctx.col.stores.findOne({ _id: storeId });
        if (!store || !isActiveStore(store)) continue;
        await this.scheduleCategories(store, crawler);
        await this.scheduleListings(store, crawler);
      }
    })().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async scheduleCategories(store: StoreDoc, crawler: StoreCrawler): Promise<void> {
    const adapter = this.o.adapters.get(store._id)!;
    const now = this.ctx.clock();
    for (const category of store.categories) {
      if (category.nextCrawlAt > now) continue;
      const leased = await this.ctx.col.stores.updateOne(
        {
          _id: store._id,
          categories: {
            $elemMatch: {
              key: category.key,
              nextCrawlAt: { $lte: now },
              $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
            },
          },
        },
        { $set: { 'categories.$.leaseUntil': new Date(now.getTime() + CATEGORY_LEASE_MS) } },
      );
      if (leased.modifiedCount === 0) continue;
      const run: RunState = {
        id: new ObjectId(),
        storeId: store._id,
        categoryKey: category.key,
        pending: 0,
        pages: 0,
        itemsSeen: 0,
        newListings: 0,
        priceChanges: 0,
        suspicious: 0,
        itemsWithoutPrice: 0,
        skippedUsed: 0,
        errors: 0,
        blocked: false,
        errorSamples: [],
      };
      await this.ctx.col.scrapeRuns.insertOne({
        _id: run.id,
        storeId: store._id,
        categoryKey: category.key,
        startedAt: now,
        finishedAt: null,
        pages: 0,
        itemsSeen: 0,
        newListings: 0,
        priceChanges: 0,
        suspicious: 0,
        itemsWithoutPrice: 0,
        skippedUsed: 0,
        errors: 0,
        outcome: null,
        errorSamples: [],
      });
      this.runs.set(run.id.toHexString(), run);
      const urls = category.startUrls.map(adapter.toFetchUrl);
      run.pending = urls.length;
      await crawler.add(
        urls.map((url) => ({
          url,
          data: {
            label: 'CATEGORY',
            runId: run.id.toHexString(),
            categoryKey: category.key,
            page: 1,
          },
        })),
      );
      this.touch();
    }
  }

  private async scheduleListings(store: StoreDoc, crawler: StoreCrawler): Promise<void> {
    const adapter = this.o.adapters.get(store._id)!;
    const rules = this.robots.get(store._id)?.rules;
    let claimed = 0;
    while (crawler.pending() < LISTING_QUEUE_LOW && claimed < LISTING_QUEUE_LOW && !this.stopping) {
      const now = this.ctx.clock();
      const listing = await this.ctx.col.listings.findOneAndUpdate(
        {
          storeId: store._id,
          status: 'active',
          'schedule.nextCheckAt': { $lte: now },
          $or: [{ 'schedule.leaseUntil': null }, { 'schedule.leaseUntil': { $lt: now } }],
        },
        { $set: { 'schedule.leaseUntil': new Date(now.getTime() + LISTING_LEASE_MS) } },
        { sort: { 'schedule.priority': -1, 'schedule.nextCheckAt': 1 }, returnDocument: 'after' },
      );
      if (!listing) break;
      claimed++;
      const url = adapter.toFetchUrl(listing.url);
      if (rules && !rules.isAllowed(url)) {
        // Disallowed URLs are skipped and counted, never fetched.
        this.ctx.logger.warn(
          { storeId: store._id, url },
          'robots.txt disallows this listing; skipped',
        );
        await this.reschedule(listing._id, listing.schedule.priority, now);
        continue;
      }
      const id = listing._id.toHexString();
      this.claimed.set(id, store._id);
      await crawler.add([{ url, data: { label: 'PRODUCT', listingId: id } }]);
      this.touch();
    }
  }

  private async reschedule(listingId: ObjectId, priority: 0 | 1 | 2, now: Date): Promise<void> {
    const minutes = checkIntervalMinutes(priority, await inBoostWindow(this.ctx, now));
    await this.ctx.col.listings.updateOne(
      { _id: listingId },
      {
        $set: {
          'schedule.nextCheckAt': new Date(now.getTime() + minutes * 60_000),
          'schedule.leaseUntil': null,
        },
      },
    );
  }

  private async crawlIntervalMinutes(
    store: StoreDoc,
    category: StoreCategory,
    now: Date,
  ): Promise<number> {
    let minutes = category.crawlEveryMinutes;
    if (store.isDemo && (this.o.demoTimeScale ?? 1) > 1)
      minutes = Math.min(minutes, FAST_DEMO_CRAWL_MINUTES);
    if (await inBoostWindow(this.ctx, now)) minutes = Math.min(minutes, BOOST_CRAWL_EVERY_MINUTES);
    return minutes;
  }

  private async finalizeRun(run: RunState, interrupted = false): Promise<void> {
    const key = run.id.toHexString();
    if (!this.runs.has(key)) return;
    this.runs.delete(key);
    const now = this.ctx.clock();
    const outcome: ScrapeRunOutcome = run.blocked
      ? 'blocked'
      : interrupted
        ? 'partial'
        : run.itemsSeen === 0 && run.errors > 0
          ? 'failed'
          : run.errors > 0
            ? 'partial'
            : 'ok';
    await this.ctx.col.scrapeRuns.updateOne(
      { _id: run.id },
      {
        $set: {
          finishedAt: now,
          outcome,
          pages: run.pages,
          itemsSeen: run.itemsSeen,
          newListings: run.newListings,
          priceChanges: run.priceChanges,
          suspicious: run.suspicious,
          itemsWithoutPrice: run.itemsWithoutPrice,
          skippedUsed: run.skippedUsed,
          errors: run.errors,
          errorSamples: run.errorSamples.slice(0, 10),
        },
      },
    );
    const store = await this.ctx.col.stores.findOne({ _id: run.storeId });
    const category = store?.categories.find((c) => c.key === run.categoryKey);
    if (!store || !category) return;
    // An interrupted run releases its lease so the next run starts it again.
    const next = interrupted
      ? category.nextCrawlAt
      : new Date(now.getTime() + (await this.crawlIntervalMinutes(store, category, now)) * 60_000);
    await this.ctx.col.stores.updateOne(
      { _id: run.storeId },
      { $set: { 'categories.$[c].leaseUntil': null, 'categories.$[c].nextCrawlAt': next } },
      { arrayFilters: [{ 'c.key': run.categoryKey }] },
    );
    this.ctx.logger.info(
      {
        storeId: run.storeId,
        category: run.categoryKey,
        outcome,
        pages: run.pages,
        items: run.itemsSeen,
        newListings: run.newListings,
        changes: run.priceChanges,
      },
      'category run finished',
    );
  }

  // ------------------------------------------------------------------------------------------
  // Page handlers
  // ------------------------------------------------------------------------------------------

  private async onPage(
    storeId: string,
    adapter: StoreAdapter,
    data: CrawlRequestData,
    page: FetchedPage,
  ): Promise<void> {
    this.touch();
    const blockReason = adapter.detectBlock(page.html, page.status);
    if (blockReason) {
      await this.onBlocked(storeId, data, page, blockReason);
      return;
    }
    if (page.status >= 500) {
      throw new RetryableError(`HTTP ${page.status}`);
    }
    if (data.label === 'CATEGORY') await this.onCategoryPage(storeId, adapter, data, page);
    else await this.onProductPage(storeId, adapter, data, page);
  }

  private async onBlocked(
    storeId: string,
    data: CrawlRequestData,
    page: FetchedPage,
    reason: string,
  ): Promise<void> {
    await incHourly(this.ctx, storeId, { blocked: 1 });
    await saveErrorSnapshot(this.ctx, {
      storeId,
      url: page.url,
      kind: 'blocked',
      httpStatus: page.status,
      message: `Blocked: ${reason}`,
      html: page.html,
    });
    const run = data.runId ? this.runs.get(data.runId) : undefined;
    if (run) {
      run.blocked = true;
      run.errorSamples.push(`blocked: ${reason}`);
    }
    if (data.listingId) this.claimed.delete(data.listingId);
    // Pause at once, with no retries; never work around a block.
    await this.pause(storeId, 'blocked');
    if (run) await this.finalizeRun(run);
  }

  private async onCategoryPage(
    storeId: string,
    adapter: StoreAdapter,
    data: CrawlRequestData,
    page: FetchedPage,
  ): Promise<void> {
    const run = data.runId ? this.runs.get(data.runId) : undefined;
    if (!run || !data.categoryKey) return;
    // A fetched page counts even when it cannot be parsed (`zero_items`, SPEC §9.6).
    run.pages++;
    try {
      const parsed = adapter.parseCategoryPage(page.html, page.url, data.categoryKey);
      if (!parsed.ok) {
        run.errors++;
        run.errorSamples.push(`${page.url}: ${parsed.message}`);
        await incHourly(this.ctx, storeId, { failures: 1 });
        await saveErrorSnapshot(this.ctx, {
          storeId,
          url: page.url,
          kind: page.status >= 400 ? 'http_error' : 'parse_error',
          httpStatus: page.status,
          message: parsed.message,
          html: page.html,
        });
        return;
      }
      await incHourly(this.ctx, storeId, { successes: 1 });
      await this.ctx.col.stores.updateOne(
        { _id: storeId },
        { $set: { 'health.lastSuccessAt': this.ctx.clock() } },
      );
      run.itemsSeen += parsed.data.items.length;
      run.skippedUsed += parsed.data.skippedUsed;
      for (const item of parsed.data.items) {
        const r = await processObservation(this.ctx, { storeId, item, source: 'category' });
        if (r.outcome === 'new') run.newListings++;
        if (r.outcome === 'new' || r.outcome === 'changed') run.priceChanges++;
        if (r.outcome === 'suspicious') run.suspicious++;
        if (r.outcome === 'no_price') run.itemsWithoutPrice++;
      }
      const next = parsed.data.nextPageUrl;
      const pageNo = data.page ?? 1;
      const crawler = this.crawlers.get(storeId);
      if (next && pageNo < MAX_CATEGORY_PAGES && crawler && !this.stopping) {
        run.pending++;
        await crawler.add([{ url: adapter.toFetchUrl(next), data: { ...data, page: pageNo + 1 } }]);
      }
    } finally {
      run.pending--;
      if (run.pending <= 0) await this.finalizeRun(run);
    }
  }

  private async onProductPage(
    storeId: string,
    adapter: StoreAdapter,
    data: CrawlRequestData,
    page: FetchedPage,
  ): Promise<void> {
    if (!data.listingId) return;
    this.claimed.delete(data.listingId);
    const listing = await this.ctx.col.listings.findOne({ _id: new ObjectId(data.listingId) });
    if (!listing || listing.status !== 'active') return;
    const parsed = adapter.parseProductPage(page.html, page.url, page.status);
    if (!parsed.ok && parsed.reason === 'not_found') {
      await incHourly(this.ctx, storeId, { successes: 1 });
      await this.onNotFound(listing._id, listing.schedule.notFoundCount, listing.schedule.priority);
      return;
    }
    if (!parsed.ok) {
      await incHourly(this.ctx, storeId, { failures: 1 });
      await saveErrorSnapshot(this.ctx, {
        storeId,
        url: page.url,
        kind: page.status >= 400 ? 'http_error' : 'parse_error',
        httpStatus: page.status,
        message: parsed.message,
        html: page.html,
      });
      await this.onListingFailure(
        listing._id,
        listing.schedule.consecutiveFailures,
        listing.schedule.priority,
      );
      return;
    }
    const item = parsed.data.find((i) => i.storeProductId === listing.storeProductId);
    await incHourly(this.ctx, storeId, { successes: 1 });
    if (!item) {
      await this.onNotFound(listing._id, listing.schedule.notFoundCount, listing.schedule.priority);
      return;
    }
    await processObservation(this.ctx, { storeId, item, source: 'product', listing });
  }

  private async onNotFound(
    listingId: ObjectId,
    notFoundCount: number,
    priority: 0 | 1 | 2,
  ): Promise<void> {
    const now = this.ctx.clock();
    const count = notFoundCount + 1;
    const minutes = checkIntervalMinutes(priority, await inBoostWindow(this.ctx, now));
    await this.ctx.col.listings.updateOne(
      { _id: listingId },
      {
        $set: {
          'schedule.notFoundCount': count,
          'schedule.leaseUntil': null,
          'schedule.nextCheckAt': new Date(now.getTime() + minutes * 60_000),
          ...(count >= NOT_FOUND_LIMIT ? { status: 'not_found' as const } : {}),
          updatedAt: now,
        },
      },
    );
  }

  private async onListingFailure(
    listingId: ObjectId,
    failures: number,
    priority: 0 | 1 | 2,
  ): Promise<void> {
    const now = this.ctx.clock();
    const count = failures + 1;
    const interval = checkIntervalMinutes(priority, await inBoostWindow(this.ctx, now));
    await this.ctx.col.listings.updateOne(
      { _id: listingId },
      {
        $set: {
          'schedule.consecutiveFailures': count,
          'schedule.leaseUntil': null,
          'schedule.nextCheckAt': new Date(
            now.getTime() + failureDelayMinutes(interval, count) * 60_000,
          ),
        },
      },
    );
  }

  /** A request failed after all retries (SPEC §9.4 "After a failure"). */
  private async onFailed(
    storeId: string,
    data: CrawlRequestData,
    url: string,
    error: Error,
  ): Promise<void> {
    this.touch();
    await incHourly(this.ctx, storeId, { failures: 1 });
    const timeout = /timed? ?out/i.test(error.message);
    await saveErrorSnapshot(this.ctx, {
      storeId,
      url,
      kind: timeout ? 'timeout' : 'http_error',
      httpStatus: Number(/HTTP (\d{3})/.exec(error.message)?.[1]) || null,
      message: error.message,
    });
    if (data.label === 'CATEGORY') {
      const run = data.runId ? this.runs.get(data.runId) : undefined;
      if (!run) return;
      run.errors++;
      run.errorSamples.push(`${url}: ${error.message}`);
      run.pending--;
      if (run.pending <= 0) await this.finalizeRun(run);
      return;
    }
    if (!data.listingId) return;
    this.claimed.delete(data.listingId);
    const listing = await this.ctx.col.listings.findOne({ _id: new ObjectId(data.listingId) });
    if (listing) {
      await this.onListingFailure(
        listing._id,
        listing.schedule.consecutiveFailures,
        listing.schedule.priority,
      );
    }
  }
}
