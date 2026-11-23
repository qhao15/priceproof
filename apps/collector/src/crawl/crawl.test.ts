import { describe, expect, it } from 'vitest';
import { RateGate } from './rate-gate.js';
import { effectiveRate, fetchRobots, parseRobots } from './robots.js';

const UA = 'PriceProofBot/1.0 (+http://localhost:5173/methodology#bot)';

describe('robots.txt', () => {
  it('parses rules and Crawl-delay for our user agent', () => {
    const rules = parseRobots(
      'http://shop.test/robots.txt',
      'User-agent: *\nDisallow: /cart\n\nUser-agent: PriceProofBot\nDisallow: /search\nCrawl-delay: 6\n',
      UA,
    );
    expect(rules.isAllowed('http://shop.test/c/phone')).toBe(true);
    expect(rules.isAllowed('http://shop.test/search?q=x')).toBe(false);
    expect(rules.crawlDelaySeconds).toBe(6);
  });

  it('uses Crawl-delay only when it is stricter than the configured rate', () => {
    expect(effectiveRate(20, null)).toBe(20);
    expect(effectiveRate(20, 6)).toBe(10);
    expect(effectiveRate(20, 1)).toBe(20);
    expect(effectiveRate(20, 120)).toBe(1);
  });

  it('treats a missing file as allow-all, 403/429 as blocked and 5xx as unavailable', async () => {
    const answer = (status: number, body = '') =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    const missing = await fetchRobots('http://shop.test', UA, answer(404));
    expect(missing.ok && missing.rules.isAllowed('http://shop.test/cart')).toBe(true);
    expect(await fetchRobots('http://shop.test', UA, answer(429))).toMatchObject({
      ok: false,
      blocked: true,
    });
    expect(await fetchRobots('http://shop.test', UA, answer(503))).toMatchObject({
      ok: false,
      blocked: false,
    });
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await fetchRobots('http://shop.test', UA, failing)).toMatchObject({
      ok: false,
      blocked: false,
    });
  });

  it('sends the honest user agent', async () => {
    let sent = '';
    const capture = (async (_url: string, init: RequestInit) => {
      sent = new Headers(init.headers).get('user-agent') ?? '';
      return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    }) as unknown as typeof fetch;
    await fetchRobots('http://shop.test', UA, capture);
    expect(sent).toBe(UA);
  });
});

describe('RateGate', () => {
  it('spaces requests at least 60 / rate seconds apart', async () => {
    let clock = 1_000_000;
    const gate = new RateGate(600, () => clock); // 100 ms apart
    await gate.wait();
    const started = Date.now();
    clock += 40;
    await gate.wait(); // must sleep the remaining ~60 ms
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('keeps the last request of the gate it replaces', async () => {
    const old = new RateGate(600);
    await old.wait();
    const started = Date.now();
    await new RateGate(300, Date.now, old).wait(); // 200 ms after the old request
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});
