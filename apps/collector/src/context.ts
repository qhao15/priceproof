import {
  COLLECTIONS,
  type CommandDoc,
  type ErrorSnapshotDoc,
  type ListingDoc,
  type NotificationDoc,
  type PriceChangeDoc,
  type ProductDoc,
  type SaleEventDoc,
  type ScrapeRunDoc,
  type StoreDoc,
  type StoreHourlyStatsDoc,
  type SystemStateDoc,
  type UserDoc,
  type WatchDoc,
} from '@priceproof/shared';
import type { Collection, Db } from 'mongodb';
import type { Logger } from 'pino';

/** Typed collections used by the collector. */
export interface Collections {
  stores: Collection<StoreDoc>;
  products: Collection<ProductDoc>;
  listings: Collection<ListingDoc>;
  priceChanges: Collection<PriceChangeDoc>;
  users: Collection<UserDoc>;
  watches: Collection<WatchDoc>;
  notifications: Collection<NotificationDoc>;
  commands: Collection<CommandDoc>;
  scrapeRuns: Collection<ScrapeRunDoc>;
  storeHourlyStats: Collection<StoreHourlyStatsDoc>;
  errorSnapshots: Collection<ErrorSnapshotDoc>;
  saleEvents: Collection<SaleEventDoc>;
  systemState: Collection<SystemStateDoc>;
}

export function collections(db: Db): Collections {
  return {
    stores: db.collection(COLLECTIONS.stores),
    products: db.collection(COLLECTIONS.products),
    listings: db.collection(COLLECTIONS.listings),
    priceChanges: db.collection(COLLECTIONS.priceChanges),
    users: db.collection(COLLECTIONS.users),
    watches: db.collection(COLLECTIONS.watches),
    notifications: db.collection(COLLECTIONS.notifications),
    commands: db.collection(COLLECTIONS.commands),
    scrapeRuns: db.collection(COLLECTIONS.scrapeRuns),
    storeHourlyStats: db.collection(COLLECTIONS.storeHourlyStats),
    errorSnapshots: db.collection(COLLECTIONS.errorSnapshots),
    saleEvents: db.collection(COLLECTIONS.saleEvents),
    systemState: db.collection(COLLECTIONS.systemState),
  };
}

/** What every collector job needs. `clock` is injectable so tests control time. */
export interface CollectorContext {
  db: Db;
  col: Collections;
  logger: Logger;
  clock: () => Date;
}

export function createContext(
  db: Db,
  logger: Logger,
  clock: () => Date = () => new Date(),
): CollectorContext {
  return { db, col: collections(db), logger, clock };
}
