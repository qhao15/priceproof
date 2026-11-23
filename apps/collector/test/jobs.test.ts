import { SALE_EVENT_SEEDS, toMongoMoney } from '@priceproof/shared';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processCommands } from '../src/commands/processor.js';
import { type CollectorContext, createContext } from '../src/context.js';
import { acquireLock, releaseLock } from '../src/crawl/lock.js';
import { initDatabase } from '../src/db/init.js';
import { CollectorEnvSchema } from '../src/env.js';
import { evaluateHealth, pauseStore, runHealthMonitor } from '../src/health/monitor.js';
import { incHourly } from '../src/health/hourly-stats.js';
import { refreshStatsIfDue, sweepLeases, syncPriorities } from '../src/jobs/maintenance.js';
import { processObservation } from '../src/processing/observation.js';
import { resetSaleEventCache } from '../src/processing/stats.js';
import { storeDefinitions } from '../src/stores/definitions.js';
import { silent } from './harness.js';
import { openTestDb, type TestDb } from './mongo.js';

let t: TestDb;
let ctx: CollectorContext;
let now = new Date('2026-11-20T05:00:00Z');

beforeAll(async () => {
  t = await openTestDb();
  const env = CollectorEnvSchema.parse({ MONGODB_URI: 'mongodb://unused' });
  await initDatabase(t.db, { stores: storeDefinitions(env), saleEvents: SALE_EVENT_SEEDS });
  ctx = createContext(t.db, silent, () => now);
  resetSaleEventCache();
});
afterAll(async () => {
  await t.close();
});

function command(type: string, payload: Record<string, unknown>) {
  return ctx.col.commands.insertOne({
    _id: new ObjectId(),
    type: type as never,
    payload,
    createdBy: null,
    status: 'pending',
    result: null,
    error: null,
    leaseUntil: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  });
}

describe('evaluateHealth (SPEC §9.6)', () => {
  const base = {
    requests: 20,
    failures: 0,
    blocked: 0,
    suspicious: 0,
    latestRun: { pages: 3, itemsSeen: 60 },
  };
  it('applies the rules in table order', () => {
    expect(evaluateHealth({ ...base, blocked: 1, failures: 15 })).toEqual({
      status: 'paused',
      reason: 'blocked',
    });
    expect(evaluateHealth({ ...base, failures: 11 })).toEqual({
      status: 'paused',
      reason: 'high_failure_rate',
    });
    expect(evaluateHealth({ ...base, requests: 9, failures: 9 })).toEqual({ status: 'degraded' });
    expect(evaluateHealth({ ...base, latestRun: { pages: 1, itemsSeen: 0 } })).toEqual({
      status: 'paused',
      reason: 'zero_items',
    });
    expect(evaluateHealth({ ...base, suspicious: 5 })).toEqual({
      status: 'paused',
      reason: 'many_suspicious_prices',
    });
    expect(evaluateHealth({ ...base, failures: 4 })).toEqual({ status: 'degraded' });
    expect(evaluateHealth({ ...base, failures: 3 })).toEqual({ status: 'ok' });
    expect(evaluateHealth({ ...base, requests: 0, latestRun: null })).toEqual({ status: 'ok' });
  });
});

describe('pause procedure', () => {
  it('pauses once, releases leases and notifies every admin per channel', async () => {
    const admins = [
      { _id: new ObjectId(), emailAlerts: true },
      { _id: new ObjectId(), emailAlerts: false },
    ];
    await ctx.col.users.insertMany(
      admins.map((a, i) => ({
        ...a,
        email: `admin${i}@example.com`,
        passwordHash: 'x',
        displayName: `Admin ${i}`,
        role: 'ADMIN' as const,
        locale: 'vi' as const,
        createdAt: now,
        lastLoginAt: null,
      })),
    );
    const paused: string[] = [];
    expect(await pauseStore(ctx, 'shopjs', 'high_failure_rate', (id) => void paused.push(id))).toBe(
      true,
    );
    expect(await pauseStore(ctx, 'shopjs', 'blocked')).toBe(false);
    expect(paused).toEqual(['shopjs']);
    const store = await ctx.col.stores.findOne({ _id: 'shopjs' });
    expect(store?.health).toMatchObject({
      status: 'paused',
      pausedReason: 'high_failure_rate',
      pausedAt: now,
    });
    const notes = await ctx.col.notifications.find({ storeId: 'shopjs' }).toArray();
    expect(notes.map((n) => n.channel).sort()).toEqual(['email', 'inapp', 'inapp']);
    expect(new Set(notes.map((n) => n.dedupeKey)).size).toBe(3);
    expect(notes.find((n) => n.channel === 'inapp')?.status).toBe('sent');
    expect(notes.find((n) => n.channel === 'email')?.status).toBe('pending');
  });

  it('health monitor pauses on blocked requests and marks degraded stores', async () => {
    await incHourly(ctx, 'demomart', { requests: 10, failures: 3 });
    await runHealthMonitor(ctx);
    expect((await ctx.col.stores.findOne({ _id: 'demomart' }))?.health.status).toBe('degraded');
    await incHourly(ctx, 'demomart', { blocked: 1 });
    await runHealthMonitor(ctx);
    expect((await ctx.col.stores.findOne({ _id: 'demomart' }))?.health).toMatchObject({
      status: 'paused',
      pausedReason: 'blocked',
    });
  });
});

describe('commands (SPEC §9.7)', () => {
  it('RESUME_STORE resumes, and the health monitor ignores what happened before the resume', async () => {
    await command('RESUME_STORE', { storeId: 'demomart' });
    const resumed: string[] = [];
    expect(await processCommands(ctx, { onStoreResumed: (id) => void resumed.push(id) })).toBe(1);
    expect(resumed).toEqual(['demomart']);
    const store = await ctx.col.stores.findOne({ _id: 'demomart' });
    expect(store?.health).toMatchObject({ status: 'ok', pausedReason: null });
    expect(store?.categories.every((c) => c.nextCrawlAt.getTime() === now.getTime())).toBe(true);
    // The blocked request from earlier in this hour must not pause it again.
    await runHealthMonitor(ctx);
    expect((await ctx.col.stores.findOne({ _id: 'demomart' }))?.health.status).toBe('ok');
  });

  it('RUN_STORE_NOW, RECHECK_LISTING and invalid payloads', async () => {
    const { listing } = await processObservation(ctx, {
      storeId: 'demomart',
      source: 'category',
      item: {
        storeProductId: 'dm-cmd-1',
        url: 'http://localhost:4000/p/a',
        title: 'Điện thoại Novix X5 8GB/128GB',
        category: 'phone',
        price: 10_090_000,
        listPrice: null,
        inStock: true,
      },
    });
    await command('RECHECK_LISTING', { listingId: listing!._id.toHexString() });
    await command('RUN_STORE_NOW', { storeId: 'shopjs' });
    await command('RECHECK_LISTING', { listingId: 'not-an-id' });
    await command('RUN_STORE_NOW', { storeId: 'nope' });
    await command('TRACK_URL', { url: 'http://localhost:4000/p/a' });
    expect(await processCommands(ctx)).toBe(4);
    const done = await ctx.col.commands.find({ status: 'done' }).toArray();
    expect(done.map((c) => c.type)).toContain('RECHECK_LISTING');
    const failed = await ctx.col.commands.find({ status: 'failed' }).toArray();
    expect(failed.map((c) => c.error?.code).sort()).toEqual(['invalid_payload', 'not_found']);
    // TRACK_URL waits for M5.
    expect(await ctx.col.commands.countDocuments({ type: 'TRACK_URL', status: 'pending' })).toBe(1);
    const l = await ctx.col.listings.findOne({ _id: listing!._id });
    expect(l?.schedule.nextCheckAt).toEqual(now);
  });

  it('CONFIRM_SUSPICIOUS trusts the held price; REJECT_SUSPICIOUS drops it', async () => {
    const item = {
      storeProductId: 'dm-cmd-2',
      url: 'http://localhost:4000/p/b',
      title: 'Laptop Kestrel Air 14',
      category: 'laptop' as const,
      price: 20_090_000,
      listPrice: null,
      inStock: true,
    };
    const { listing } = await processObservation(ctx, {
      storeId: 'demomart',
      source: 'category',
      item,
    });
    const firstSeen = new Date(now.getTime() + 60_000);
    now = firstSeen;
    await processObservation(ctx, {
      storeId: 'demomart',
      source: 'product',
      item: { ...item, price: 2_090_000 },
    });
    now = new Date(now.getTime() + 60_000);
    await command('CONFIRM_SUSPICIOUS', { listingId: listing!._id.toHexString() });
    await processCommands(ctx);
    const confirmed = await ctx.col.listings.findOne({ _id: listing!._id });
    expect(confirmed?.current).toMatchObject({
      price: 2_090_000,
      confirmed: true,
      changedAt: firstSeen,
    });
    expect(confirmed?.pendingSuspicious).toBeNull();
    const points = await ctx.col.priceChanges.find({ 'meta.listingId': listing!._id }).toArray();
    expect(points.map((p) => p.source).sort()).toEqual(['admin_confirmed', 'category']);

    await ctx.col.listings.updateOne(
      { _id: listing!._id },
      {
        $set: {
          pendingSuspicious: {
            price: toMongoMoney(90_090_000),
            listPrice: null,
            inStock: true,
            firstSeenAt: now,
            lastSeenAt: now,
            seenCount: 1,
          },
        },
      },
    );
    await command('REJECT_SUSPICIOUS', { listingId: listing!._id.toHexString() });
    await processCommands(ctx);
    const rejected = await ctx.col.listings.findOne({ _id: listing!._id });
    expect(rejected?.pendingSuspicious).toBeNull();
    expect(rejected?.current.price).toBe(2_090_000);
  });
});

describe('collector lock (SPEC §9.1)', () => {
  it('lets only one owner hold it until it expires or is released', async () => {
    now = new Date('2026-11-21T00:00:00Z');
    expect(await acquireLock(ctx, 'a')).toBe(true);
    expect(await acquireLock(ctx, 'b')).toBe(false);
    expect(await acquireLock(ctx, 'a')).toBe(true); // renew
    now = new Date(now.getTime() + 3 * 60_000); // expired
    expect(await acquireLock(ctx, 'b')).toBe(true);
    await releaseLock(ctx, 'a'); // not the owner: no effect
    expect(await acquireLock(ctx, 'a')).toBe(false);
    await releaseLock(ctx, 'b');
    expect(await acquireLock(ctx, 'a')).toBe(true);
    await releaseLock(ctx, 'a');
  });
});

describe('maintenance jobs', () => {
  it('sweeps expired leases and fails timed-out commands', async () => {
    now = new Date('2026-11-21T01:00:00Z');
    const past = new Date(now.getTime() - 1000);
    await ctx.col.listings.updateMany({}, { $set: { 'schedule.leaseUntil': past } });
    await ctx.col.stores.updateOne(
      { _id: 'shopjs' },
      { $set: { 'categories.0.leaseUntil': past } },
    );
    await ctx.col.commands.updateOne(
      { type: 'TRACK_URL' },
      { $set: { status: 'processing', leaseUntil: past } },
    );
    await sweepLeases(ctx);
    expect(await ctx.col.listings.countDocuments({ 'schedule.leaseUntil': { $ne: null } })).toBe(0);
    expect((await ctx.col.stores.findOne({ _id: 'shopjs' }))?.categories[0]?.leaseUntil).toBeNull();
    expect((await ctx.col.commands.findOne({ type: 'TRACK_URL' }))?.error?.code).toBe('timeout');
  });

  it('priority sync raises watched listings to priority 2 and brings their check forward', async () => {
    const l = (await ctx.col.listings.findOne({ storeProductId: 'dm-cmd-1' }))!;
    await ctx.col.listings.updateOne(
      { _id: l._id },
      {
        $set: {
          'schedule.priority': 0,
          'schedule.nextCheckAt': new Date(now.getTime() + 86_400_000),
        },
      },
    );
    await ctx.col.watches.insertOne({
      _id: new ObjectId(),
      userId: new ObjectId(),
      productId: l.productId,
      targetPrice: null,
      notifyBackInStock: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(await syncPriorities(ctx)).toBeGreaterThanOrEqual(1);
    const after = (await ctx.col.listings.findOne({ _id: l._id }))!;
    expect(after.schedule.priority).toBe(2);
    expect(after.schedule.nextCheckAt.getTime()).toBe(now.getTime() + 120 * 60_000);
  });

  it('runs the daily stats refresh once per ICT day, after 03:00', async () => {
    now = new Date('2026-11-21T19:30:00Z'); // 02:30 ICT on the 22nd
    expect(await refreshStatsIfDue(ctx)).toBe(false);
    now = new Date('2026-11-21T20:30:00Z'); // 03:30 ICT
    expect(await refreshStatsIfDue(ctx)).toBe(true);
    expect(await refreshStatsIfDue(ctx)).toBe(false);
    expect((await ctx.col.systemState.findOne({ _id: 'collector' }))?.lastStatsRefreshDate).toBe(
      '2026-11-22',
    );
  });
});
