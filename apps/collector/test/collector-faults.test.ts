import { ObjectId } from 'mongodb';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, pageRequests } from './harness.js';

let h: Harness | null = null;

afterEach(async () => {
  await h?.close();
  h = null;
});

async function store(id: string) {
  return (await h!.ctx.col.stores.findOne({ _id: id }))!;
}

describe('DEMO_FAULTS=layoutV2', () => {
  it('pauses DemoMart (zero_items), and RESUME_STORE resumes it after the fault is removed', async () => {
    h = await createHarness({ faults: ['layoutV2'], enabled: ['demomart'] });
    await h.collector().runOnce(2);

    const paused = await store('demomart');
    expect(paused.health.status).toBe('paused');
    expect(['zero_items', 'high_failure_rate']).toContain(paused.health.pausedReason);
    expect(await h.ctx.col.listings.countDocuments()).toBe(0);
    const runs = await h.ctx.col.scrapeRuns.find().toArray();
    // The first failed run pauses the store; runs cut off by the pause are partial.
    expect(runs.every((r) => r.itemsSeen === 0)).toBe(true);
    expect(runs.some((r) => r.outcome === 'failed')).toBe(true);
    const snapshots = await h.ctx.col.errorSnapshots.find({ kind: 'parse_error' }).toArray();
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]!.htmlGzip).not.toBeNull();

    // A paused store is not crawled.
    const before = h.events.length;
    await h.collector().runOnce(1);
    expect(h.events.length).toBe(before);

    // Remove the fault, then resume through the command queue.
    await h.restartDemoStores([]);
    await h.ctx.col.commands.insertOne({
      _id: new ObjectId(),
      type: 'RESUME_STORE',
      payload: { storeId: 'demomart' },
      createdBy: null,
      status: 'pending',
      result: null,
      error: null,
      leaseUntil: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    });
    await h.collector().runOnce(2);

    const resumed = await store('demomart');
    expect(resumed.health).toMatchObject({ status: 'ok', pausedReason: null, pausedAt: null });
    const cmd = await h.ctx.col.commands.findOne({ type: 'RESUME_STORE' });
    expect(cmd?.status).toBe('done');
    expect(await h.ctx.col.listings.countDocuments({ storeId: 'demomart' })).toBeGreaterThan(100);
  }, 240_000);
});

describe('DEMO_FAULTS=block429', () => {
  it('pauses the store as blocked on the first 429, with no retries', async () => {
    h = await createHarness({ faults: ['block429'], enabled: ['demomart'] });
    await h.collector().runOnce(1);

    const s = await store('demomart');
    expect(s.health).toMatchObject({ status: 'paused', pausedReason: 'blocked' });
    const requests = pageRequests(h.events, 'demomart');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: '/robots.txt', status: 429 });
    const snapshot = await h.ctx.col.errorSnapshots.findOne({ kind: 'blocked' });
    expect(snapshot?.httpStatus).toBe(429);
  }, 120_000);
});

describe('DEMO_FAULTS=captcha', () => {
  it('pauses the store as blocked on the CAPTCHA page', async () => {
    h = await createHarness({ faults: ['captcha'], enabled: ['demomart'] });
    await h.collector().runOnce(1);
    const s = await store('demomart');
    expect(s.health).toMatchObject({ status: 'paused', pausedReason: 'blocked' });
    // robots.txt and one category page; nothing after the block.
    expect(pageRequests(h.events, 'demomart').length).toBeLessThanOrEqual(2);
  }, 120_000);
});
