import { MongoClient } from 'mongodb';

/** Creates the collector's MongoDB client (not connected yet). */
export function createMongoClient(uri: string): MongoClient {
  return new MongoClient(uri, {
    appName: 'priceproof-collector',
    serverSelectionTimeoutMS: 15_000,
  });
}

/** Hides the user name and password in a connection string, for logs. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/, '$1***@');
}

/** Describes the deployment from a `hello` command reply. */
export function describeClusterType(hello: { msg?: unknown; setName?: unknown }): string {
  if (hello.msg === 'isdbgrid') {
    return 'sharded cluster (mongos)';
  }
  if (typeof hello.setName === 'string') {
    return `replica set "${hello.setName}"`;
  }
  return 'standalone';
}
