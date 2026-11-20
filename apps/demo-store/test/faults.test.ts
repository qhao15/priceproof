import { afterEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import {
  type DemoFault,
  type RunningDemoStores,
  startDemoStores,
  stopDemoStores,
} from '../src/index.js';
import { unit } from '../src/random.js';

const silent = pino({ level: 'silent' });

async function start(faults: DemoFault[], random?: () => number): Promise<RunningDemoStores> {
  return startDemoStores({
    demoMartPort: 0,
    shopJsPort: 0,
    fixedNow: '2026-11-20T05:00:00Z',
    faults,
    random,
    logger: silent,
    env: {},
  });
}

afterEach(async () => {
  await stopDemoStores();
});

/** Counts product cards the way a v1 parser would (by the original CSS classes). */
function v1Cards(html: string): number {
  return (html.match(/class="(product-card|item) card"/g) ?? []).length;
}

describe('DEMO_FAULTS=block429', () => {
  it('answers 429 to every request, robots.txt and the prices API included', async () => {
    const s = await start(['block429']);
    for (const url of [
      `${s.demoMartUrl}/`,
      `${s.demoMartUrl}/c/phone`,
      `${s.demoMartUrl}/robots.txt`,
      `${s.shopJsUrl}/c/phone`,
      `${s.shopJsUrl}/api/prices?ids=sj0001`,
      `${s.shopJsUrl}/static/shop.js`,
    ]) {
      const res = await fetch(url);
      expect(res.status, url).toBe(429);
      expect(res.headers.get('retry-after')).toBe('3600');
    }
  });

  it('leaves the ground-truth endpoint working', async () => {
    const s = await start(['block429']);
    expect((await fetch(`${s.demoMartUrl}/__demo/truth`)).status).toBe(200);
  });
});

describe('DEMO_FAULTS=captcha', () => {
  it('serves a CAPTCHA page instead of store pages', async () => {
    const s = await start(['captcha']);
    for (const url of [
      `${s.demoMartUrl}/c/phone`,
      `${s.shopJsUrl}/c/laptop`,
      `${s.demoMartUrl}/`,
    ]) {
      const res = await fetch(url);
      const html = await res.text();
      expect(html, url).toContain('id="captcha"');
      expect(html, url).toMatch(/CAPTCHA/);
      expect(v1Cards(html)).toBe(0);
    }
    const robots = await fetch(`${s.demoMartUrl}/robots.txt`);
    expect(await robots.text()).toContain('Disallow: /cart');
  });
});

describe('DEMO_FAULTS=errors5pct', () => {
  it('fails a request with HTTP 500 when the random draw is below 5%', async () => {
    const draws = [0.01, 0.5, 0.049, 0.05, 0.99];
    const s = await start(['errors5pct'], () => draws.shift() ?? 0.5);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await fetch(`${s.demoMartUrl}/c/phone`)).status);
    }
    expect(statuses).toEqual([500, 200, 500, 200, 200]);
  });

  it('fails about 5% of requests', async () => {
    let i = 0;
    const s = await start(['errors5pct'], () => unit('errors-test', i++));
    let failures = 0;
    const total = 400;
    for (let n = 0; n < total; n++) {
      const url = n % 2 === 0 ? `${s.demoMartUrl}/robots.txt` : `${s.shopJsUrl}/robots.txt`;
      if ((await fetch(url)).status === 500) failures++;
    }
    expect(failures / total).toBeGreaterThan(0.02);
    expect(failures / total).toBeLessThan(0.09);
  });
});

describe('DEMO_FAULTS=layoutV2', () => {
  it('renames the CSS classes, so parsers written for the normal layout find nothing', async () => {
    const normal = await start([]);
    const before = await (await fetch(`${normal.demoMartUrl}/c/phone`)).text();
    const beforeJs = await (await fetch(`${normal.shopJsUrl}/c/phone`)).text();
    expect(v1Cards(before)).toBe(24);
    expect(v1Cards(beforeJs)).toBe(24);
    expect(before).toContain('class="price now"');
    await stopDemoStores();

    const s = await start(['layoutV2']);
    const dm = await (await fetch(`${s.demoMartUrl}/c/phone`)).text();
    const sj = await (await fetch(`${s.shopJsUrl}/c/phone`)).text();
    for (const html of [dm, sj]) {
      expect(v1Cards(html)).toBe(0);
      expect(html).not.toContain('next-page');
    }
    expect(dm).not.toContain('class="price now"');
    expect(dm).toContain('tile-v2');
    expect(sj).toContain('result-v2');
    // The page itself still works: same products, same status.
    expect((await fetch(`${s.demoMartUrl}/c/phone`)).status).toBe(200);
  });
});

describe('DEMO_FAULTS validation', () => {
  it('rejects unknown fault names', async () => {
    await expect(
      startDemoStores({ demoMartPort: 0, shopJsPort: 0, env: { DEMO_FAULTS: 'layoutV3' } }),
    ).rejects.toThrow(/DEMO_FAULTS/);
  });

  it('reads faults from the environment when not given', async () => {
    const s = await startDemoStores({
      demoMartPort: 0,
      shopJsPort: 0,
      logger: silent,
      env: { DEMO_FAULTS: 'block429, captcha' },
    });
    expect((await fetch(`${s.demoMartUrl}/`)).status).toBe(429);
  });
});
