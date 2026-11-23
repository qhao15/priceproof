import { randomBytes } from 'node:crypto';
import { type Db, MongoClient } from 'mongodb';
import { inject } from 'vitest';

export interface TestDb {
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
}

/** A fresh, empty database on the throwaway test replica set. */
export async function openTestDb(): Promise<TestDb> {
  const client = new MongoClient(inject('mongoUri'));
  await client.connect();
  const db = client.db(`test_${randomBytes(6).toString('hex')}`);
  return {
    client,
    db,
    async close() {
      await db.dropDatabase();
      await client.close();
    },
  };
}
