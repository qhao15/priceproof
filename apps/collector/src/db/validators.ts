import { CATEGORY_KEYS, COLLECTIONS, DEAL_LABELS, PAUSE_REASONS } from '@priceproof/shared';
import type { Document } from 'mongodb';

/**
 * `$jsonSchema` validators (SPEC §6.4), applied by db:init with `validationLevel: "moderate"` and
 * `validationAction: "error"`. A validator error usually means a writer used the wrong BSON type:
 * fix the writer, not the validator.
 */

const date = { bsonType: 'date' };
const dateOrNull = { bsonType: ['date', 'null'] };
const long = { bsonType: 'long' };
const longOrNull = { bsonType: ['long', 'null'] };
const string = { bsonType: 'string' };
const bool = { bsonType: 'bool' };
const int = { bsonType: ['int', 'long'] };
const objectId = { bsonType: 'objectId' };
const category = { enum: [...CATEGORY_KEYS] };

const stores = {
  bsonType: 'object',
  required: [
    '_id',
    'name',
    'isDemo',
    'hosts',
    'baseUrl',
    'fetchMethod',
    'enabled',
    'rateLimit',
    'categories',
    'health',
  ],
  properties: {
    _id: string,
    name: string,
    isDemo: bool,
    hosts: { bsonType: 'array', items: string },
    baseUrl: string,
    showLinks: bool,
    fetchMethod: { enum: ['http', 'browser'] },
    enabled: bool,
    rateLimit: {
      bsonType: 'object',
      required: ['requestsPerMinute'],
      properties: {
        requestsPerMinute: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 60 },
      },
    },
    categories: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['key', 'startUrls', 'crawlEveryMinutes', 'nextCrawlAt'],
        properties: {
          key: category,
          startUrls: { bsonType: 'array', items: string },
          crawlEveryMinutes: { bsonType: ['int', 'long', 'double'], minimum: 1 },
          nextCrawlAt: date,
          leaseUntil: dateOrNull,
        },
      },
    },
    health: {
      bsonType: 'object',
      required: ['status'],
      properties: {
        status: { enum: ['ok', 'degraded', 'paused'] },
        pausedReason: { enum: [...PAUSE_REASONS, null] },
        pausedAt: dateOrNull,
        lastSuccessAt: dateOrNull,
      },
    },
    createdAt: date,
    updatedAt: date,
  },
};

const products = {
  bsonType: 'object',
  required: ['category', 'name', 'searchText', 'matchKey', 'attrs', 'createdBy', 'createdAt'],
  properties: {
    category,
    brand: { bsonType: ['string', 'null'] },
    name: string,
    searchText: string,
    matchKey: string,
    attrs: { bsonType: 'object' },
    createdBy: { enum: ['auto', 'admin'] },
    createdAt: date,
    updatedAt: date,
  },
};

const listings = {
  bsonType: 'object',
  required: [
    'storeId',
    'storeProductId',
    'url',
    'urlKey',
    'title',
    'category',
    'productId',
    'status',
    'current',
    'stats',
    'schedule',
    'firstSeenAt',
    'lastSeenAt',
    'createdAt',
  ],
  properties: {
    storeId: string,
    storeProductId: string,
    url: string,
    urlKey: string,
    title: string,
    category,
    variant: { bsonType: 'object' },
    productId: objectId,
    status: { enum: ['active', 'not_found', 'ignored'] },
    trackedAt: dateOrNull,
    current: {
      bsonType: 'object',
      required: ['price', 'listPrice', 'inStock', 'changedAt', 'checkedAt', 'confirmed'],
      properties: {
        price: long,
        listPrice: longOrNull,
        inStock: bool,
        changedAt: date,
        priceSince: dateOrNull,
        checkedAt: date,
        confirmed: bool,
      },
    },
    pendingSuspicious: {
      bsonType: ['object', 'null'],
      properties: {
        price: long,
        listPrice: longOrNull,
        inStock: bool,
        firstSeenAt: date,
        lastSeenAt: date,
        seenCount: int,
      },
    },
    stats: {
      bsonType: 'object',
      required: ['dealLabel', 'computedAt'],
      properties: {
        referencePrice: longOrNull,
        realDiscountPct: { bsonType: ['double', 'int', 'null'] },
        advertisedDiscountPct: { bsonType: ['double', 'int'] },
        dealLabel: { enum: [...DEAL_LABELS] },
        historyDays: int,
        windowCoverageDays: int,
        lowest30d: longOrNull,
        lowest90d: longOrNull,
        highest90d: longOrNull,
        computedAt: date,
      },
    },
    schedule: {
      bsonType: 'object',
      required: ['priority', 'nextCheckAt'],
      properties: {
        priority: { enum: [0, 1, 2] },
        nextCheckAt: date,
        leaseUntil: dateOrNull,
        lastObservedAt: dateOrNull,
        consecutiveFailures: int,
        notFoundCount: int,
      },
    },
    firstSeenAt: date,
    lastSeenAt: date,
    createdAt: date,
    updatedAt: date,
  },
};

const users = {
  bsonType: 'object',
  required: ['email', 'passwordHash', 'displayName', 'role', 'locale', 'emailAlerts', 'createdAt'],
  properties: {
    email: string,
    passwordHash: string,
    displayName: string,
    role: { enum: ['MEMBER', 'ADMIN', 'DEMO_ADMIN'] },
    locale: { enum: ['vi', 'en'] },
    emailAlerts: bool,
    createdAt: date,
    lastLoginAt: dateOrNull,
  },
};

const watches = {
  bsonType: 'object',
  required: ['userId', 'productId', 'targetPrice', 'notifyBackInStock', 'createdAt'],
  properties: {
    userId: objectId,
    productId: objectId,
    targetPrice: longOrNull,
    notifyBackInStock: bool,
    createdAt: date,
    updatedAt: date,
  },
};

/** Validators by collection name. */
export const VALIDATORS: Record<string, Document> = {
  [COLLECTIONS.stores]: { $jsonSchema: stores },
  [COLLECTIONS.products]: { $jsonSchema: products },
  [COLLECTIONS.listings]: { $jsonSchema: listings },
  [COLLECTIONS.users]: { $jsonSchema: users },
  [COLLECTIONS.watches]: { $jsonSchema: watches },
};
