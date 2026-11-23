import type { CollectorEnv } from '../env.js';
import { createDemoMartAdapter } from './demomart/adapter.js';
import { createShopJsAdapter } from './shopjs/adapter.js';
import type { StoreAdapter } from './types.js';

type AdapterEnv = Pick<
  CollectorEnv,
  'DEMOMART_PUBLIC_URL' | 'DEMOMART_FETCH_URL' | 'SHOPJS_PUBLIC_URL' | 'SHOPJS_FETCH_URL'
>;

/** Adapters by store ID. */
export function createAdapters(env: AdapterEnv): Map<string, StoreAdapter> {
  const adapters = [
    createDemoMartAdapter({ publicUrl: env.DEMOMART_PUBLIC_URL, fetchUrl: env.DEMOMART_FETCH_URL }),
    createShopJsAdapter({ publicUrl: env.SHOPJS_PUBLIC_URL, fetchUrl: env.SHOPJS_FETCH_URL }),
  ];
  return new Map(adapters.map((a) => [a.storeId, a]));
}
