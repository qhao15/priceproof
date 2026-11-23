import { CATEGORY_KEYS } from '@priceproof/shared';
import type { CollectorEnv } from '../env.js';
import type { StoreDefinition } from './types.js';

/** Default and maximum crawl rate (hard rules). */
export const DEFAULT_REQUESTS_PER_MINUTE = 20;
export const MAX_REQUESTS_PER_MINUTE = 60;
/** Demo stores are local and small, so their categories are crawled every hour. */
export const DEMO_CRAWL_EVERY_MINUTES = 60;

type StoreEnv = Pick<CollectorEnv, 'NODE_ENV' | 'DEMOMART_PUBLIC_URL' | 'SHOPJS_PUBLIC_URL'>;

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase().replace(/^www\./, '');
}

function demoStore(
  id: string,
  name: string,
  baseUrl: string,
  fetchMethod: 'http' | 'browser',
  env: StoreEnv,
): StoreDefinition {
  return {
    id,
    name,
    isDemo: true,
    hosts: [hostOf(baseUrl)],
    baseUrl,
    // v1 has no public copy of the demo stores, so production hides "Go to store" links.
    showLinks: env.NODE_ENV !== 'production',
    fetchMethod,
    enabledByDefault: true,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    categories: CATEGORY_KEYS.map((key) => ({
      key,
      startUrls: [`${baseUrl}/c/${key}`],
      crawlEveryMinutes: DEMO_CRAWL_EVERY_MINUTES,
    })),
  };
}

/** Every store defined in code. Real stores are added here in M3 (with `enabledByDefault: false`). */
export function storeDefinitions(env: StoreEnv): StoreDefinition[] {
  return [
    demoStore('demomart', 'DemoMart', env.DEMOMART_PUBLIC_URL, 'http', env),
    demoStore('shopjs', 'ShopJS', env.SHOPJS_PUBLIC_URL, 'browser', env),
  ];
}
