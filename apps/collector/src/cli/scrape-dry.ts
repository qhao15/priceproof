import { parseArgs } from 'node:util';
import { isCategoryKey, type ScrapedItem } from '@priceproof/shared';
import { PageFetcher } from '../crawl/fetch-page.js';
import { RateGate } from '../crawl/rate-gate.js';
import { fetchRobots } from '../crawl/robots.js';
import { DEFAULT_REQUESTS_PER_MINUTE, storeDefinitions } from '../stores/definitions.js';
import { createAdapters } from '../stores/registry.js';
import { cliEnv, formatVnd, table } from './common.js';
import { print, printError } from './output.js';

/**
 * `pnpm scrape:dry --store <id> --category <key> --pages 1` or `--url <productUrl>` (SPEC §9.10):
 * fetches and parses pages and prints the items. Never writes to MongoDB. Respects robots.txt and
 * the store's default rate; refuses more than 3 pages for real stores.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      store: { type: 'string' },
      category: { type: 'string' },
      pages: { type: 'string', default: '1' },
      url: { type: 'string' },
    },
  });
  const env = cliEnv();
  if (!env) return 1;
  const def = storeDefinitions(env).find((s) => s.id === values.store);
  const adapter = values.store ? createAdapters(env).get(values.store) : undefined;
  if (!def || !adapter) {
    printError(
      `--store must be one of: ${storeDefinitions(env)
        .map((s) => s.id)
        .join(', ')}`,
    );
    return 1;
  }
  const pages = Number(values.pages);
  if (!Number.isInteger(pages) || pages < 1 || (!def.isDemo && pages > 3)) {
    printError(
      def.isDemo ? '--pages must be a positive integer' : '--pages must be 1 to 3 for real stores',
    );
    return 1;
  }
  if (!values.url && !(values.category && isCategoryKey(values.category))) {
    printError('Give --category phone|laptop|headphones, or --url <product URL>');
    return 1;
  }

  const startUrl = values.url ?? adapter.categoryStartUrls(values.category as never)[0]!;
  const origin = new URL(adapter.toFetchUrl(startUrl)).origin;
  const robots = await fetchRobots(origin, env.SCRAPER_USER_AGENT);
  if (!robots.ok) {
    printError(
      `Stopped: ${robots.reason}${robots.blocked ? ' (the store blocks us; do not retry)' : ''}`,
    );
    return 1;
  }
  const gate = new RateGate(
    Math.min(
      def.requestsPerMinute,
      DEFAULT_REQUESTS_PER_MINUTE,
      robots.rules.crawlDelaySeconds ? 60 / robots.rules.crawlDelaySeconds : 60,
    ),
  );
  await gate.wait(); // counts the robots.txt request
  const fetcher = new PageFetcher(adapter, env.SCRAPER_USER_AGENT);
  const items: ScrapedItem[] = [];
  try {
    let url: string | null = startUrl;
    for (let page = 1; url && page <= (values.url ? 1 : pages); page++) {
      const fetchUrl = adapter.toFetchUrl(url);
      if (!robots.rules.isAllowed(fetchUrl)) {
        printError(`robots.txt disallows ${fetchUrl}; not fetched`);
        return 1;
      }
      await gate.wait();
      const res = await fetcher.fetch(fetchUrl);
      const block = adapter.detectBlock(res.html, res.status);
      print(`GET ${fetchUrl} → ${res.status}${block ? ` BLOCKED (${block})` : ''}`);
      if (block) return 1;
      if (values.url) {
        const parsed = adapter.parseProductPage(res.html, res.url, res.status);
        if (!parsed.ok) {
          printError(`${parsed.reason}: ${parsed.message}`);
          return 1;
        }
        items.push(...parsed.data);
        url = null;
      } else {
        const parsed = adapter.parseCategoryPage(res.html, res.url, values.category as never);
        if (!parsed.ok) {
          printError(`${parsed.reason}: ${parsed.message}`);
          return 1;
        }
        items.push(...parsed.data.items);
        print(`  ${parsed.data.items.length} items, ${parsed.data.skippedUsed} used skipped`);
        url = parsed.data.nextPageUrl;
      }
    }
  } finally {
    await fetcher.close();
  }
  print('');
  print(
    table([
      ['storeProductId', 'price', 'listPrice', 'stock', 'title'],
      ...items.map((i) => [
        i.storeProductId,
        formatVnd(i.price),
        formatVnd(i.listPrice),
        i.inStock ? 'in' : 'out',
        i.title.slice(0, 70),
      ]),
    ]),
  );
  print(`\n${items.length} items (dry run: nothing was written to MongoDB)`);
  return 0;
}

process.exitCode = await main();
