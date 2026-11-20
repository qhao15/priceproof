import { type CategoryKey, normalizeText } from '@priceproof/shared';
import { pick, unit } from './random.js';

/**
 * The fictional catalog of the demo stores (SPEC §14.2). Everything here is computed from fixed
 * data and the fixed seed, so every copy of the demo stores lists exactly the same items.
 */

export const DEMO_STORE_IDS = ['demomart', 'shopjs'] as const;
export type DemoStoreId = (typeof DEMO_STORE_IDS)[number];

export const DEMO_STORE_NAMES: Record<DemoStoreId, string> = {
  demomart: 'DemoMart',
  shopjs: 'ShopJS',
};

/** Canonical color keys (as in `packages/shared/data/colors.json`) and their Vietnamese names. */
export const COLOR_NAMES_VI = {
  black: 'Đen',
  white: 'Trắng',
  silver: 'Bạc',
  gray: 'Xám',
  blue: 'Xanh dương',
  green: 'Xanh lá',
  purple: 'Tím',
  pink: 'Hồng',
  gold: 'Gold',
  titanium: 'Titan',
} as const;
export type ColorKey = keyof typeof COLOR_NAMES_VI;

export interface DemoCpu {
  /** Short form used in titles, for example "i5" or "R7". */
  short: string;
  /** Model number, for example "1335U". */
  model: string;
}

export interface DemoProduct {
  /** Stable ID, for example "ph-007". */
  id: string;
  category: CategoryKey;
  brand: string;
  /** Products of one family are look-alikes that must never be matched with each other. */
  family: string;
  /** Model name without the brand, for example "X5 Pro Max". */
  model: string;
  network?: '4G' | '5G';
  ramGb?: number;
  storageGb?: number;
  cpu?: DemoCpu;
  /** Laptop model code, for example "KA14-512". */
  modelCode?: string;
  colors: ColorKey[];
  /** Used / display units. Their listings carry used markers and must be skipped by the collector. */
  used: boolean;
  /** Regular price before drift, VND, ending in "…90.000". */
  basePrice: number;
  /** Canonical name, for the ground truth. */
  name: string;
}

export interface DemoListing {
  storeId: DemoStoreId;
  storeProductId: string;
  /** URL path segment after `/p/`. */
  slug: string;
  productId: string;
  category: CategoryKey;
  title: string;
  /** Set when the listing is one specific color (ShopJS splits some phones by color). */
  color: ColorKey | null;
  /** Shows "Liên hệ" instead of a price. */
  contactOnly: boolean;
}

/** Rounds to the nearest price ending in "…90.000". */
export function round90(vnd: number): number {
  return Math.max(0, Math.round((vnd - 90_000) / 100_000)) * 100_000 + 90_000;
}

/** Rounds down to a price ending in "…90.000". */
export function floor90(vnd: number): number {
  return Math.max(0, Math.floor((vnd - 90_000) / 100_000)) * 100_000 + 90_000;
}

function storageText(gb: number): string {
  return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`;
}

// ---------------------------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------------------------

interface PhoneFamily {
  brand: string;
  family: string;
  model: string;
  network?: '4G' | '5G';
  /** [RAM GB, storage GB] per variant. */
  variants: [number, number][];
  /** Price of the smallest variant, in millions of VND. */
  base: number;
  colors: ColorKey[];
}

// prettier-ignore
const PHONE_FAMILIES: PhoneFamily[] = [
  // Tier variants (X5 / X5 Pro / X5 Pro Max / X5 FE), RAM-only and storage-only differences
  { brand: 'Novix', family: 'novix-x5', model: 'X5', network: '5G', variants: [[8, 128], [12, 128], [8, 256], [12, 256]], base: 10, colors: ['black', 'blue', 'green'] },
  { brand: 'Novix', family: 'novix-x5', model: 'X5 Pro', network: '5G', variants: [[12, 256], [12, 512]], base: 15, colors: ['black', 'titanium', 'silver'] },
  { brand: 'Novix', family: 'novix-x5', model: 'X5 Pro Max', network: '5G', variants: [[12, 256], [12, 512]], base: 19, colors: ['black', 'titanium'] },
  { brand: 'Novix', family: 'novix-x5', model: 'X5 FE', network: '5G', variants: [[8, 128], [8, 256]], base: 8, colors: ['black', 'purple'] },
  { brand: 'Novix', family: 'novix-x5', model: 'X4', network: '5G', variants: [[8, 128], [8, 256]], base: 7, colors: ['black', 'white'] },
  { brand: 'Novix', family: 'novix-x6', model: 'X6', network: '5G', variants: [[8, 256], [12, 256]], base: 13, colors: ['black', 'blue', 'pink'] },
  { brand: 'Novix', family: 'novix-x6', model: 'X6 Pro', network: '5G', variants: [[12, 256], [12, 512]], base: 18, colors: ['black', 'titanium'] },
  { brand: 'Novix', family: 'novix-x6', model: 'X6 Pro Max', network: '5G', variants: [[12, 512], [16, 512]], base: 24, colors: ['black', 'titanium', 'gold'] },
  // Generation numbers (Novix 14 / Novix 15)
  { brand: 'Novix', family: 'novix-number', model: '14', network: '5G', variants: [[8, 128], [8, 256]], base: 12, colors: ['black', 'white', 'blue'] },
  { brand: 'Novix', family: 'novix-number', model: '15', network: '5G', variants: [[8, 128], [8, 256], [12, 512]], base: 16, colors: ['black', 'pink', 'green'] },
  // 4G vs 5G
  { brand: 'Novix', family: 'novix-a3', model: 'A3', network: '4G', variants: [[4, 64], [4, 128]], base: 3, colors: ['black', 'blue'] },
  { brand: 'Novix', family: 'novix-a3', model: 'A3', network: '5G', variants: [[6, 128], [8, 128], [8, 256]], base: 4, colors: ['black', 'blue', 'green'] },
  { brand: 'Novix', family: 'novix-a3', model: 'A4', network: '5G', variants: [[6, 128], [8, 256]], base: 5, colors: ['black', 'white'] },
  { brand: 'Zentra', family: 'zentra-z9', model: 'Z9', network: '5G', variants: [[8, 256], [12, 256]], base: 14, colors: ['black', 'gray', 'blue'] },
  { brand: 'Zentra', family: 'zentra-z9', model: 'Z9 Plus', network: '5G', variants: [[12, 256], [12, 512]], base: 17, colors: ['black', 'gray'] },
  { brand: 'Zentra', family: 'zentra-z9', model: 'Z9 Ultra', network: '5G', variants: [[12, 512], [16, 512]], base: 23, colors: ['black', 'titanium'] },
  { brand: 'Zentra', family: 'zentra-z9', model: 'Z9 Lite', network: '5G', variants: [[8, 128]], base: 7, colors: ['black', 'purple'] },
  { brand: 'Zentra', family: 'zentra-z9', model: 'Z8', network: '5G', variants: [[8, 128], [8, 256]], base: 9, colors: ['black', 'green'] },
  { brand: 'Zentra', family: 'zentra-z10', model: 'Z10', network: '5G', variants: [[8, 256], [12, 512]], base: 16, colors: ['black', 'blue', 'silver'] },
  { brand: 'Zentra', family: 'zentra-z10', model: 'Z10 Plus', network: '5G', variants: [[12, 256]], base: 19, colors: ['black', 'silver'] },
  { brand: 'Zentra', family: 'zentra-z10', model: 'Z10 Ultra', network: '5G', variants: [[16, 512]], base: 27, colors: ['black', 'titanium'] },
  { brand: 'Zentra', family: 'zentra-nova', model: 'Nova 7', network: '4G', variants: [[8, 128]], base: 5, colors: ['black', 'blue'] },
  { brand: 'Zentra', family: 'zentra-nova', model: 'Nova 7', network: '5G', variants: [[8, 128], [8, 256]], base: 6, colors: ['black', 'blue', 'pink'] },
  { brand: 'Zentra', family: 'zentra-nova', model: 'Nova 8', network: '4G', variants: [[8, 128]], base: 6, colors: ['black', 'white'] },
  { brand: 'Zentra', family: 'zentra-nova', model: 'Nova 8', network: '5G', variants: [[8, 256], [12, 256]], base: 8, colors: ['black', 'white', 'green'] },
  { brand: 'Zentra', family: 'zentra-fold', model: 'Fold 2', network: '5G', variants: [[12, 512]], base: 38, colors: ['black', 'silver'] },
  { brand: 'Zentra', family: 'zentra-fold', model: 'Flip 2', network: '5G', variants: [[8, 256], [8, 512]], base: 21, colors: ['black', 'purple', 'gold'] },
  { brand: 'Zentra', family: 'zentra-c', model: 'C2', network: '4G', variants: [[4, 64], [4, 128], [6, 128]], base: 2.5, colors: ['black', 'blue'] },
];

/** Used phones: [family model, network, RAM, storage]. */
const USED_PHONES: [string, string, number, number][] = [
  ['X5 Pro', 'Novix', 12, 256],
  ['Z9 Ultra', 'Zentra', 12, 512],
  ['14', 'Novix', 8, 128],
  ['Z8', 'Zentra', 8, 128],
];

function phoneVariantPrice(
  base: number,
  ram: number,
  storage: number,
  first: [number, number],
): number {
  const storageSteps = Math.log2(storage / first[1]);
  const ramSteps = (ram - first[0]) / 2;
  return round90(base * 1_000_000 * (1 + 0.14 * storageSteps + 0.04 * ramSteps));
}

function buildPhones(): DemoProduct[] {
  const products: Omit<DemoProduct, 'id'>[] = [];
  for (const f of PHONE_FAMILIES) {
    const first = f.variants[0]!;
    for (const [ram, storage] of f.variants) {
      const fullModel = f.network === '4G' ? `${f.model} 4G` : f.model;
      products.push({
        category: 'phone',
        brand: f.brand,
        family: f.family,
        model: f.model,
        network: f.network,
        ramGb: ram,
        storageGb: storage,
        colors: f.colors,
        used: false,
        basePrice: phoneVariantPrice(f.base, ram, storage, first),
        name: `${f.brand} ${fullModel} ${ram}GB/${storageText(storage)}`,
      });
    }
  }
  for (const [model, brand, ram, storage] of USED_PHONES) {
    const original = products.find(
      (p) => p.brand === brand && p.model === model && p.ramGb === ram && p.storageGb === storage,
    )!;
    products.push({
      ...original,
      used: true,
      basePrice: round90(original.basePrice * 0.72),
      name: `${original.name} (used)`,
    });
  }
  return products.map((p, i) => ({ ...p, id: `ph-${String(i + 1).padStart(3, '0')}` }));
}

// ---------------------------------------------------------------------------------------------
// Laptops
// ---------------------------------------------------------------------------------------------

const CPUS: Record<string, DemoCpu & { price: number }> = {
  i5: { short: 'i5', model: '1335U', price: 0 },
  i7: { short: 'i7', model: '1355U', price: 3.5 },
  i7h: { short: 'i7', model: '13700H', price: 5 },
  u7: { short: 'Ultra 7', model: '155H', price: 7 },
  r5: { short: 'R5', model: '7520U', price: 0 },
  r7: { short: 'R7', model: '7730U', price: 2.5 },
  r7h: { short: 'R7', model: '7735HS', price: 4 },
  r9: { short: 'R9', model: '7940HS', price: 9 },
};

interface LaptopFamily {
  brand: string;
  family: string;
  model: string;
  /** Model code prefix; the code is `<prefix>-<storage>`, shared by every CPU option. */
  code: string;
  /** [CPU key, RAM GB, storage GB] per variant. */
  variants: [keyof typeof CPUS, number, number][];
  /** Price of the cheapest configuration, in millions of VND. */
  base: number;
  color: ColorKey;
}

// prettier-ignore
const LAPTOP_FAMILIES: LaptopFamily[] = [
  { brand: 'Kestrel', family: 'kestrel-air', model: 'Air 13', code: 'KA13', variants: [['i5', 8, 256], ['i5', 8, 512], ['i7', 16, 512]], base: 15, color: 'silver' },
  { brand: 'Kestrel', family: 'kestrel-air', model: 'Air 14', code: 'KA14', variants: [['i5', 8, 256], ['i5', 16, 512], ['i7', 16, 512], ['i7', 16, 1024]], base: 17, color: 'silver' },
  { brand: 'Kestrel', family: 'kestrel-air', model: 'Air 15', code: 'KA15', variants: [['i5', 8, 256], ['i5', 16, 512], ['i7', 16, 512], ['i7', 32, 1024]], base: 19, color: 'gray' },
  { brand: 'Kestrel', family: 'kestrel-pro', model: 'Pro 14', code: 'KP14', variants: [['i5', 16, 512], ['i7', 16, 512], ['i7h', 32, 1024]], base: 24, color: 'gray' },
  { brand: 'Kestrel', family: 'kestrel-pro', model: 'Pro 16', code: 'KP16', variants: [['i7h', 16, 512], ['i7h', 32, 1024], ['u7', 32, 1024]], base: 30, color: 'gray' },
  { brand: 'Kestrel', family: 'kestrel-swift', model: 'Swift 13', code: 'KS13', variants: [['i5', 8, 256], ['i5', 16, 512], ['i7', 16, 512]], base: 13, color: 'silver' },
  { brand: 'Kestrel', family: 'kestrel-swift', model: 'Swift 14', code: 'KS14', variants: [['i5', 8, 512], ['i7', 16, 512]], base: 15, color: 'blue' },
  { brand: 'Kestrel', family: 'kestrel-flex', model: 'Flex 14', code: 'KF14', variants: [['i5', 8, 256], ['i5', 16, 512], ['i7', 16, 512], ['i7', 16, 1024]], base: 16, color: 'silver' },
  { brand: 'Kestrel', family: 'kestrel-gaming', model: 'G15', code: 'KG15', variants: [['i5', 16, 512], ['i7h', 16, 512], ['i7h', 32, 1024]], base: 22, color: 'black' },
  { brand: 'Kestrel', family: 'kestrel-gaming', model: 'G16', code: 'KG16', variants: [['i7h', 16, 1024], ['u7', 32, 1024]], base: 29, color: 'black' },
  { brand: 'Corvane', family: 'corvane-book', model: 'Book 14', code: 'CB14', variants: [['r5', 8, 256], ['r5', 16, 512], ['r7', 16, 512]], base: 12, color: 'silver' },
  { brand: 'Corvane', family: 'corvane-book', model: 'Book 14 Pro', code: 'CB14P', variants: [['r7', 16, 512], ['r7', 32, 1024]], base: 17, color: 'gray' },
  { brand: 'Corvane', family: 'corvane-book', model: 'Book 14 Plus', code: 'CB14X', variants: [['r5', 16, 512], ['r7', 16, 1024]], base: 14, color: 'silver' },
  { brand: 'Corvane', family: 'corvane-book', model: 'Book 15', code: 'CB15', variants: [['r5', 16, 512], ['r7', 16, 512], ['i5', 16, 512]], base: 14, color: 'gray' },
  { brand: 'Corvane', family: 'corvane-book', model: 'Book 16', code: 'CB16', variants: [['r5', 16, 512], ['r7', 16, 1024], ['r7', 32, 1024]], base: 16, color: 'gray' },
  { brand: 'Corvane', family: 'corvane-slim', model: 'Slim 13', code: 'CS13', variants: [['i5', 8, 256], ['i5', 16, 512]], base: 14, color: 'silver' },
  { brand: 'Corvane', family: 'corvane-slim', model: 'Slim 14', code: 'CS14', variants: [['i5', 16, 512], ['i7', 16, 512], ['i7', 32, 1024]], base: 16, color: 'blue' },
  { brand: 'Corvane', family: 'corvane-aero', model: 'Aero 15', code: 'CA15', variants: [['i5', 16, 512], ['i7', 16, 512], ['i7', 32, 1024]], base: 18, color: 'silver' },
  { brand: 'Corvane', family: 'corvane-volt', model: 'Volt 15', code: 'CV15', variants: [['r7h', 16, 512], ['r9', 32, 1024]], base: 23, color: 'black' },
  { brand: 'Corvane', family: 'corvane-volt', model: 'Volt 17', code: 'CV17', variants: [['r7h', 16, 1024], ['r9', 32, 1024]], base: 27, color: 'black' },
];

/** Used laptops: [model code], picked from the variants above. */
const USED_LAPTOPS: [string, keyof typeof CPUS][] = [
  ['KA14-512', 'i5'],
  ['CB14-256', 'r5'],
  ['KG15-512', 'i7h'],
];

function laptopCode(prefix: string, storage: number): string {
  return `${prefix}-${storage >= 1024 ? `${storage / 1024}T` : storage}`;
}

function buildLaptops(): DemoProduct[] {
  const products: (Omit<DemoProduct, 'id'> & { cpuKey: string })[] = [];
  for (const f of LAPTOP_FAMILIES) {
    for (const [cpuKey, ram, storage] of f.variants) {
      const cpu = CPUS[cpuKey]!;
      const code = laptopCode(f.code, storage);
      const millions = f.base + cpu.price + (ram - 8) * 0.35 + Math.log2(storage / 256) * 1.8;
      products.push({
        cpuKey,
        category: 'laptop',
        brand: f.brand,
        family: f.family,
        model: f.model,
        modelCode: code,
        cpu: { short: cpu.short, model: cpu.model },
        ramGb: ram,
        storageGb: storage,
        colors: [f.color],
        used: false,
        basePrice: round90(millions * 1_000_000),
        name: `${f.brand} ${f.model} ${code} ${cpu.short} ${cpu.model}/${ram}GB/${storageText(storage)}`,
      });
    }
  }
  for (const [code, cpuKey] of USED_LAPTOPS) {
    const original = products.find((p) => p.modelCode === code && p.cpuKey === cpuKey)!;
    products.push({
      ...original,
      used: true,
      basePrice: round90(original.basePrice * 0.75),
      name: `${original.name} (used)`,
    });
  }
  return products.map(({ cpuKey: _cpuKey, ...p }, i) => ({
    ...p,
    id: `lt-${String(i + 1).padStart(3, '0')}`,
  }));
}

// ---------------------------------------------------------------------------------------------
// Headphones
// ---------------------------------------------------------------------------------------------

type HeadphoneKind = 'tws' | 'over' | 'sport' | 'neck';

/** [brand, family, model, price in millions, kind, colors]. */
// prettier-ignore
const HEADPHONES: [string, string, string, number, HeadphoneKind, ColorKey[]][] = [
  ['Auralis', 'auralis-pods', 'Pods 3', 2.5, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-pods', 'Pods 3 Lite', 1.5, 'tws', ['white']],
  ['Auralis', 'auralis-pods', 'Pods 3 Pro', 3.9, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-pods', 'Pods 4', 3.2, 'tws', ['white', 'black', 'blue']],
  ['Auralis', 'auralis-pods', 'Pods 4 Lite', 1.9, 'tws', ['white', 'pink']],
  ['Auralis', 'auralis-pods', 'Pods 4 Pro', 4.9, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-pods', 'Pods 5', 3.9, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-pods', 'Pods 5 Pro', 5.9, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-pods', 'Pods 5 Max', 7.9, 'over', ['black', 'silver']],
  ['Auralis', 'auralis-air', 'Pods Air 2', 2.2, 'tws', ['white']],
  ['Auralis', 'auralis-air', 'Pods Air 3', 2.9, 'tws', ['white', 'blue']],
  ['Auralis', 'auralis-studio', 'Studio H1', 4.5, 'over', ['black', 'silver']],
  ['Auralis', 'auralis-studio', 'Studio H1 Pro', 5.9, 'over', ['black']],
  ['Auralis', 'auralis-studio', 'Studio H2', 6.5, 'over', ['black', 'white']],
  ['Auralis', 'auralis-studio', 'Studio H2 Pro', 7.9, 'over', ['black', 'silver']],
  ['Auralis', 'auralis-studio', 'Studio H2 Max', 9.9, 'over', ['black']],
  ['Auralis', 'auralis-studio', 'Studio H3', 8.5, 'over', ['black', 'white']],
  ['Auralis', 'auralis-sport', 'Sport S1', 1.7, 'sport', ['black', 'green']],
  ['Auralis', 'auralis-sport', 'Sport S2', 2.3, 'sport', ['black', 'blue']],
  ['Auralis', 'auralis-sport', 'Sport S2 Plus', 2.9, 'sport', ['black']],
  ['Auralis', 'auralis-sport', 'Sport S3', 3.3, 'sport', ['black', 'pink']],
  ['Auralis', 'auralis-bass', 'Bass B7', 1.9, 'over', ['black', 'blue']],
  ['Auralis', 'auralis-bass', 'Bass B8', 2.6, 'over', ['black', 'gray']],
  ['Auralis', 'auralis-bass', 'Bass B8 Pro', 3.4, 'over', ['black']],
  ['Auralis', 'auralis-bass', 'Bass B9', 3.9, 'over', ['black', 'gray']],
  ['Auralis', 'auralis-neck', 'Neckband N3', 1.3, 'neck', ['black']],
  ['Auralis', 'auralis-neck', 'Neckband N4', 1.6, 'neck', ['black', 'blue']],
  ['Auralis', 'auralis-buds', 'Buds Mini', 1.2, 'tws', ['white', 'black']],
  ['Auralis', 'auralis-buds', 'Buds Mini 2', 1.5, 'tws', ['white', 'pink']],
  ['Orcana', 'orcana-wave', 'Wave 4', 2.8, 'tws', ['black', 'white']],
  ['Orcana', 'orcana-wave', 'Wave 5', 3.5, 'tws', ['black', 'white']],
  ['Orcana', 'orcana-wave', 'Wave 5 Lite', 2.2, 'tws', ['black', 'blue']],
  ['Orcana', 'orcana-wave', 'Wave 5 Pro', 4.9, 'tws', ['black', 'silver']],
  ['Orcana', 'orcana-wave', 'Wave 6', 4.2, 'tws', ['black', 'white']],
  ['Orcana', 'orcana-wave', 'Wave 6 Pro', 5.9, 'tws', ['black', 'silver']],
  ['Orcana', 'orcana-buds', 'Buds X2', 1.9, 'tws', ['black', 'white']],
  ['Orcana', 'orcana-buds', 'Buds X3', 2.4, 'tws', ['black', 'white', 'purple']],
  ['Orcana', 'orcana-buds', 'Buds X3 Plus', 2.9, 'tws', ['black', 'white']],
  ['Orcana', 'orcana-buds', 'Buds X3 Pro', 3.6, 'tws', ['black']],
  ['Orcana', 'orcana-buds', 'Buds X4', 3.1, 'tws', ['black', 'green']],
  ['Orcana', 'orcana-echo', 'Echo 300', 3.9, 'over', ['black', 'silver']],
  ['Orcana', 'orcana-echo', 'Echo 500', 5.5, 'over', ['black', 'silver']],
  ['Orcana', 'orcana-echo', 'Echo 700', 7.5, 'over', ['black', 'white']],
  ['Orcana', 'orcana-echo', 'Echo 700 Pro', 8.9, 'over', ['black']],
  ['Orcana', 'orcana-echo', 'Echo 900', 9.9, 'over', ['black', 'silver']],
  ['Orcana', 'orcana-tide', 'Tide T1', 1.4, 'sport', ['black', 'blue']],
  ['Orcana', 'orcana-tide', 'Tide T2', 1.8, 'sport', ['black', 'green']],
  ['Orcana', 'orcana-tide', 'Tide T2 SE', 1.5, 'sport', ['black']],
  ['Orcana', 'orcana-tide', 'Tide T3', 2.3, 'sport', ['black', 'blue']],
  ['Orcana', 'orcana-reef', 'Reef R10', 2.1, 'over', ['black', 'blue']],
  ['Orcana', 'orcana-reef', 'Reef R20', 2.9, 'over', ['black', 'gray']],
  ['Orcana', 'orcana-reef', 'Reef R20 Max', 3.9, 'over', ['black']],
  ['Orcana', 'orcana-reef', 'Reef R30', 3.5, 'over', ['black', 'gray']],
  ['Orcana', 'orcana-halo', 'Halo 4', 2.6, 'tws', ['white', 'black']],
  ['Orcana', 'orcana-halo', 'Halo 5', 3.3, 'tws', ['white', 'black']],
  ['Orcana', 'orcana-halo', 'Halo 5 Ultra', 4.6, 'tws', ['white', 'black']],
  ['Orcana', 'orcana-halo', 'Halo 6', 3.9, 'tws', ['white', 'pink']],
  ['Orcana', 'orcana-kids', 'Kids K1', 1.2, 'over', ['blue', 'pink']],
];

const USED_HEADPHONES = ['Pods 4 Pro', 'Echo 700'];

const HEADPHONE_KIND_VI: Record<HeadphoneKind, string> = {
  tws: 'Bluetooth True Wireless',
  over: 'chụp tai Bluetooth',
  sport: 'thể thao không dây',
  neck: 'Bluetooth đeo cổ',
};

function headphoneKind(p: DemoProduct): HeadphoneKind {
  return (
    HEADPHONES.find(([brand, , model]) => brand === p.brand && model === p.model)?.[4] ?? 'tws'
  );
}

function buildHeadphones(): DemoProduct[] {
  const products: Omit<DemoProduct, 'id'>[] = [];
  for (const [brand, family, model, millions, , colors] of HEADPHONES) {
    products.push({
      category: 'headphones',
      brand,
      family,
      model,
      colors,
      used: false,
      basePrice: round90(millions * 1_000_000),
      name: `${brand} ${model}`,
    });
  }
  for (const model of USED_HEADPHONES) {
    const original = products.find((p) => p.model === model)!;
    products.push({
      ...original,
      used: true,
      basePrice: round90(original.basePrice * 0.7),
      name: `${original.name} (used)`,
    });
  }
  return products.map((p, i) => ({ ...p, id: `hp-${String(i + 1).padStart(3, '0')}` }));
}

// ---------------------------------------------------------------------------------------------
// Listings and titles
// ---------------------------------------------------------------------------------------------

/** Share of the catalog each store sells (SPEC §14.2: about 85%). */
const SELL_SHARE = 0.85;
/** Share of a store's listings that show "Liên hệ" instead of a price. */
const CONTACT_SHARE = 0.03;
/** Share of multi-color phones that ShopJS lists once per color. */
const COLOR_SPLIT_SHARE = 0.4;

const DEMOMART_SUFFIXES = ['Chính hãng', 'Chính hãng VN/A', 'Chính hãng, Trả góp 0%'];
const SHOPJS_SUFFIXES = ['Chính hãng', 'Fullbox', 'BH 12 tháng'];

function demoMartTitle(p: DemoProduct): string {
  const suffix = pick(DEMOMART_SUFFIXES, 'dm-suffix', p.id);
  switch (p.category) {
    case 'phone': {
      const net = p.network === '4G' ? ' 4G' : '';
      const body = `Điện thoại ${p.brand} ${p.model}${net} ${p.ramGb}GB/${storageText(p.storageGb!)}`;
      return p.used ? `${body} - Like new 99%` : `${body} - ${suffix}`;
    }
    case 'laptop': {
      const body = `Laptop ${p.brand} ${p.model} ${p.modelCode} ${p.cpu!.short} ${p.cpu!.model}/${p.ramGb}GB/${storageText(p.storageGb!)}`;
      return p.used ? `${body} - Hàng trưng bày` : `${body} - ${suffix}`;
    }
    case 'headphones': {
      const kind = HEADPHONE_KIND_VI[headphoneKind(p)];
      const body = `Tai nghe ${kind} ${p.brand} ${p.model}`;
      return p.used ? `${body} - Like new 99%` : `${body} - ${suffix}`;
    }
  }
}

function shopJsTitle(p: DemoProduct, color: ColorKey | null): string {
  const suffix = pick(SHOPJS_SUFFIXES, 'sj-suffix', p.id);
  switch (p.category) {
    case 'phone': {
      // Network first, storage before RAM: a different word order from DemoMart.
      const net = p.network ? ` ${p.network}` : '';
      const body = `${p.brand} ${p.model}${net} ${storageText(p.storageGb!)} (${p.ramGb}GB RAM)`;
      if (p.used) {
        return `(Máy cũ) ${body}`;
      }
      return color ? `${body} - ${COLOR_NAMES_VI[color]}` : `${body} | ${suffix}`;
    }
    case 'laptop': {
      // Only some titles say which CPU they have (SPEC §8.4 worked example).
      const cpu = unit('sj-cpu', p.id) < 0.5 ? ` Core ${p.cpu!.short}` : '';
      const body = `${p.brand} ${p.model} (${p.modelCode})${cpu} ${p.ramGb}GB ${storageText(p.storageGb!)} ${COLOR_NAMES_VI[p.colors[0]!]}`;
      return p.used ? `(Like new) ${body}` : body;
    }
    case 'headphones': {
      const body = `${p.brand} ${p.model} Tai nghe không dây`;
      return p.used ? `${body} - Hàng trưng bày` : `${body} (${COLOR_NAMES_VI[p.colors[0]!]})`;
    }
  }
}

function slugify(text: string): string {
  return normalizeText(text).replace(/ /g, '-');
}

function productSlug(p: DemoProduct): string {
  const parts = [p.brand, p.model];
  if (p.network === '4G') parts.push('4g');
  if (p.modelCode) parts.push(p.modelCode, p.cpu!.short);
  if (p.ramGb && p.category === 'phone') parts.push(`${p.ramGb}gb`, `${p.storageGb}gb`);
  if (p.ramGb && p.category === 'laptop') parts.push(`${p.ramGb}gb`);
  if (p.used) parts.push('cu');
  return slugify(parts.join(' '));
}

function sells(p: DemoProduct, storeId: DemoStoreId): boolean {
  if (p.used) {
    return true;
  }
  const a = unit('sells', p.id, 'demomart') < SELL_SHARE;
  const b = unit('sells', p.id, 'shopjs') < SELL_SHARE;
  // Every product is sold by at least one store.
  return storeId === 'demomart' ? a || !b : b;
}

function buildListings(products: DemoProduct[]): DemoListing[] {
  const listings: DemoListing[] = [];
  let dm = 0;
  let sj = 0;
  for (const p of products) {
    const contact = (storeId: DemoStoreId) =>
      !p.used && unit('contact', p.id, storeId) < CONTACT_SHARE;
    if (sells(p, 'demomart')) {
      dm += 1;
      listings.push({
        storeId: 'demomart',
        storeProductId: `dm-${10000 + dm}`,
        slug: productSlug(p),
        productId: p.id,
        category: p.category,
        title: demoMartTitle(p),
        color: p.category === 'phone' ? null : p.colors[0]!,
        contactOnly: contact('demomart'),
      });
    }
    if (sells(p, 'shopjs')) {
      const split =
        p.category === 'phone' &&
        !p.used &&
        p.colors.length > 1 &&
        unit('split', p.id) < COLOR_SPLIT_SHARE;
      const colors: (ColorKey | null)[] = split
        ? p.colors
        : [p.category === 'phone' ? null : p.colors[0]!];
      for (const color of colors) {
        sj += 1;
        const id = `sj${String(sj).padStart(4, '0')}`;
        listings.push({
          storeId: 'shopjs',
          storeProductId: id,
          slug: `${id}-${productSlug(p)}${color && split ? `-${color}` : ''}`,
          productId: p.id,
          category: p.category,
          title: shopJsTitle(p, split ? color : null),
          color,
          contactOnly: contact('shopjs'),
        });
      }
    }
  }
  return listings;
}

export interface DemoCatalog {
  products: readonly DemoProduct[];
  listings: readonly DemoListing[];
  productById: ReadonlyMap<string, DemoProduct>;
  listingsByStore: Readonly<Record<DemoStoreId, readonly DemoListing[]>>;
}

let cached: DemoCatalog | undefined;

/** The demo catalog. Built once per process; always the same content. */
export function getCatalog(): DemoCatalog {
  if (!cached) {
    const products = [...buildPhones(), ...buildLaptops(), ...buildHeadphones()];
    const listings = buildListings(products);
    cached = {
      products,
      listings,
      productById: new Map(products.map((p) => [p.id, p])),
      listingsByStore: {
        demomart: listings.filter((l) => l.storeId === 'demomart'),
        shopjs: listings.filter((l) => l.storeId === 'shopjs'),
      },
    };
  }
  return cached;
}

/** Variant attributes of a listing, as a collector would read them. */
export function listingVariant(listing: DemoListing): {
  color?: ColorKey;
  storageGb?: number;
  ramGb?: number;
} {
  const p = getCatalog().productById.get(listing.productId)!;
  return {
    ...(listing.color ? { color: listing.color } : {}),
    ...(p.storageGb ? { storageGb: p.storageGb } : {}),
    ...(p.ramGb ? { ramGb: p.ramGb } : {}),
  };
}
