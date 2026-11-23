import type { Long, ObjectId } from 'mongodb';
import type { CategoryKey } from './categories.js';
import type { DealLabel } from './discount/config.js';
import type { Priority } from './schedule/schedule.js';

/** Database name on both Atlas clusters (SPEC §6.1). */
export const DB_NAME = 'priceproof';

/** Collection names (SPEC §6.3). */
export const COLLECTIONS = {
  stores: 'stores',
  products: 'products',
  listings: 'listings',
  priceChanges: 'priceChanges',
  matchCandidates: 'matchCandidates',
  users: 'users',
  refreshTokens: 'refreshTokens',
  watches: 'watches',
  notifications: 'notifications',
  commands: 'commands',
  scrapeRuns: 'scrapeRuns',
  storeHourlyStats: 'storeHourlyStats',
  errorSnapshots: 'errorSnapshots',
  saleEvents: 'saleEvents',
  systemState: 'systemState',
} as const;

/**
 * Integer VND. Written as BSON Int64 (`toMongoMoney`); the driver reads it back as a plain number
 * (`promoteLongs`). Read through `fromMongoMoney` when the type matters.
 */
export type Money = number | Long;

export type FetchMethod = 'http' | 'browser';
export type StoreHealthStatus = 'ok' | 'degraded' | 'paused';
export const PAUSE_REASONS = [
  'blocked',
  'high_failure_rate',
  'zero_items',
  'many_suspicious_prices',
  'robots_disallowed',
] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export interface StoreCategory {
  key: CategoryKey;
  startUrls: string[];
  crawlEveryMinutes: number;
  nextCrawlAt: Date;
  leaseUntil: Date | null;
}

export interface StoreDoc {
  _id: string;
  name: string;
  isDemo: boolean;
  hosts: string[];
  baseUrl: string;
  showLinks: boolean;
  fetchMethod: FetchMethod;
  enabled: boolean;
  rateLimit: { requestsPerMinute: number };
  categories: StoreCategory[];
  health: {
    status: StoreHealthStatus;
    pausedReason: PauseReason | null;
    pausedAt: Date | null;
    lastSuccessAt: Date | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductAttrs {
  storageGb?: number;
  ramGb?: number;
  cpu?: string;
  tiers: string[];
  modelCodes: string[];
  numbers: string[];
}

export interface ProductDoc {
  _id: ObjectId;
  category: CategoryKey;
  brand: string | null;
  name: string;
  searchText: string;
  matchKey: string;
  attrs: ProductAttrs;
  createdBy: 'auto' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

export type ListingStatus = 'active' | 'not_found' | 'ignored';

export interface ListingCurrent {
  price: Money;
  listPrice: Money | null;
  inStock: boolean;
  changedAt: Date;
  priceSince: Date | null;
  checkedAt: Date;
  confirmed: boolean;
}

export interface PendingSuspicious {
  price: Money;
  listPrice: Money | null;
  inStock: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  seenCount: number;
}

export interface ListingStatsDoc {
  referencePrice: Money | null;
  realDiscountPct: number | null;
  advertisedDiscountPct: number;
  dealLabel: DealLabel;
  historyDays: number;
  windowCoverageDays: number;
  lowest30d: Money | null;
  lowest90d: Money | null;
  highest90d: Money | null;
  computedAt: Date;
}

export interface ListingSchedule {
  priority: Priority;
  nextCheckAt: Date;
  leaseUntil: Date | null;
  lastObservedAt: Date | null;
  consecutiveFailures: number;
  notFoundCount: number;
}

export interface ListingVariant {
  color?: string;
  storageGb?: number;
  ramGb?: number;
}

export interface ListingDoc {
  _id: ObjectId;
  storeId: string;
  storeProductId: string;
  url: string;
  urlKey: string;
  title: string;
  category: CategoryKey;
  variant: ListingVariant;
  productId: ObjectId;
  status: ListingStatus;
  trackedAt: Date | null;
  current: ListingCurrent;
  pendingSuspicious: PendingSuspicious | null;
  stats: ListingStatsDoc;
  schedule: ListingSchedule;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PriceChangeSource = 'category' | 'product' | 'admin_confirmed' | 'demo_backfill';

export interface PriceChangeDoc {
  _id?: ObjectId;
  at: Date;
  meta: { listingId: ObjectId; storeId: string };
  price: Money;
  listPrice: Money | null;
  inStock: boolean;
  source: PriceChangeSource;
}

export type UserRole = 'MEMBER' | 'ADMIN' | 'DEMO_ADMIN';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  locale: 'vi' | 'en';
  emailAlerts: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface WatchDoc {
  _id: ObjectId;
  userId: ObjectId;
  productId: ObjectId;
  targetPrice: Money | null;
  notifyBackInStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationKind =
  | 'price_below_target'
  | 'back_in_stock'
  | 'admin_store_paused'
  | 'tracking_started'
  | 'tracking_failed';
export type NotificationChannel = 'inapp' | 'email';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface NotificationDoc {
  _id?: ObjectId;
  userId: ObjectId;
  kind: NotificationKind;
  channel: NotificationChannel;
  watchId: ObjectId | null;
  productId: ObjectId | null;
  listingId: ObjectId | null;
  storeId: string | null;
  price: Money | null;
  dedupeKey: string;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  error: string | null;
  readAt: Date | null;
  createdAt: Date;
  sentAt: Date | null;
}

export const COMMAND_TYPES = [
  'TRACK_URL',
  'RECHECK_LISTING',
  'CONFIRM_SUSPICIOUS',
  'REJECT_SUSPICIOUS',
  'RUN_STORE_NOW',
  'RESUME_STORE',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export type CommandStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface CommandDoc {
  _id: ObjectId;
  type: CommandType;
  payload: Record<string, unknown>;
  createdBy: ObjectId | null;
  status: CommandStatus;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  leaseUntil: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type ScrapeRunOutcome = 'ok' | 'partial' | 'failed' | 'blocked';

export interface ScrapeRunDoc {
  _id: ObjectId;
  storeId: string;
  categoryKey: CategoryKey;
  startedAt: Date;
  finishedAt: Date | null;
  pages: number;
  itemsSeen: number;
  newListings: number;
  priceChanges: number;
  suspicious: number;
  itemsWithoutPrice: number;
  skippedUsed: number;
  errors: number;
  outcome: ScrapeRunOutcome | null;
  errorSamples: string[];
}

export interface StoreHourlyStatsDoc {
  _id: string;
  storeId: string;
  hour: Date;
  requests: number;
  successes: number;
  failures: number;
  blocked: number;
  observations: number;
  changes: number;
  suspicious: number;
}

export type ErrorSnapshotKind = 'parse_error' | 'http_error' | 'blocked' | 'timeout';

export interface ErrorSnapshotDoc {
  _id?: ObjectId;
  storeId: string;
  url: string;
  kind: ErrorSnapshotKind;
  httpStatus: number | null;
  message: string;
  htmlGzip: Uint8Array | null;
  createdAt: Date;
}

export interface SaleEventDoc {
  _id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  boostCrawl: boolean;
}

export interface SystemStateDoc {
  _id: 'collector';
  lockOwner: string | null;
  lockUntil: Date;
  lastRunMode: 'once' | 'daemon' | null;
  lastRunStartedAt: Date | null;
  lastRunFinishedAt: Date | null;
  lastStatsRefreshDate: string | null;
}
