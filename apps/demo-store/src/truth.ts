import { type CategoryKey, SALE_EVENT_SEEDS } from '@priceproof/shared';
import {
  type ColorKey,
  DEMO_STORE_IDS,
  DEMO_STORE_NAMES,
  type DemoStoreId,
  getCatalog,
} from './catalog.js';
import { DEMO_SEED } from './random.js';
import { type Scenario, scenarioFor } from './prices.js';

export interface DemoTruthListing {
  storeId: DemoStoreId;
  storeProductId: string;
  /** Path of the product page, relative to the store's base URL. */
  path: string;
  title: string;
  color: ColorKey | null;
  contactOnly: boolean;
}

export interface DemoTruthProduct {
  productId: string;
  category: CategoryKey;
  brand: string;
  /** Products of one family are look-alikes (X5 / X5 Pro, i5 / i7, 4G / 5G…), never one product. */
  family: string;
  name: string;
  used: boolean;
  attrs: {
    network?: string;
    ramGb?: number;
    storageGb?: number;
    cpu?: string;
    modelCode?: string;
  };
  /** Scenario per sale event ID. */
  scenarios: Record<string, Scenario>;
  /** Every listing of this product: listings in one entry are the same product. */
  listings: DemoTruthListing[];
}

export interface DemoTruth {
  seed: string;
  stores: { id: DemoStoreId; name: string; fetchMethod: 'http' | 'browser' }[];
  events: { id: string; name: string; startsAt: string; endsAt: string }[];
  products: DemoTruthProduct[];
}

let cached: DemoTruth | undefined;

/** Ground truth for evaluation (SPEC §14.5 `GET /__demo/truth`). Independent of time. */
export function getTruth(): DemoTruth {
  if (cached) {
    return cached;
  }
  const { products, listings } = getCatalog();
  cached = {
    seed: DEMO_SEED,
    stores: DEMO_STORE_IDS.map((id) => ({
      id,
      name: DEMO_STORE_NAMES[id],
      fetchMethod: id === 'demomart' ? 'http' : 'browser',
    })),
    events: SALE_EVENT_SEEDS.map((e) => ({
      id: e.id,
      name: e.name,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
    })),
    products: products.map((p) => ({
      productId: p.id,
      category: p.category,
      brand: p.brand,
      family: p.family,
      name: p.name,
      used: p.used,
      attrs: {
        ...(p.network ? { network: p.network } : {}),
        ...(p.ramGb ? { ramGb: p.ramGb } : {}),
        ...(p.storageGb ? { storageGb: p.storageGb } : {}),
        ...(p.cpu ? { cpu: `${p.cpu.short} ${p.cpu.model}` } : {}),
        ...(p.modelCode ? { modelCode: p.modelCode } : {}),
      },
      scenarios: Object.fromEntries(SALE_EVENT_SEEDS.map((e) => [e.id, scenarioFor(p.id, e.id)])),
      listings: listings
        .filter((l) => l.productId === p.id)
        .map((l) => ({
          storeId: l.storeId,
          storeProductId: l.storeProductId,
          path: `/p/${l.slug}`,
          title: l.title,
          color: l.color,
          contactOnly: l.contactOnly,
        })),
    })),
  };
  return cached;
}
