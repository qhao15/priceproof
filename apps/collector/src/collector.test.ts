import { EnvValidationError } from '@priceproof/shared';
import { describe, expect, it } from 'vitest';
import { describeClusterType, redactMongoUri } from './db/client.js';
import { CollectorEnvSchema } from './env.js';

describe('CollectorEnvSchema', () => {
  it('requires a MongoDB URI and applies defaults', () => {
    expect(CollectorEnvSchema.parse({ MONGODB_URI: 'mongodb+srv://u:p@c.example.net/' })).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      APP_TIMEZONE: 'Asia/Ho_Chi_Minh',
      MONGODB_URI: 'mongodb+srv://u:p@c.example.net/',
      PUBLIC_WEB_URL: 'http://localhost:5173',
      SCRAPER_USER_AGENT: 'PriceProofBot/1.0 (+http://localhost:5173/methodology#bot)',
      DEMO_STORES_EMBEDDED: false,
      DEMOMART_PUBLIC_URL: 'http://localhost:4000',
      DEMOMART_FETCH_URL: 'http://localhost:4000',
      SHOPJS_PUBLIC_URL: 'http://localhost:4001',
      SHOPJS_FETCH_URL: 'http://localhost:4001',
      DEMO_TIME_SCALE: 1,
    });
    expect(CollectorEnvSchema.safeParse({}).success).toBe(false);
  });

  it('parses booleans, trims trailing slashes and requires an honest bot user agent', () => {
    const env = CollectorEnvSchema.parse({
      MONGODB_URI: 'mongodb://localhost',
      DEMO_STORES_EMBEDDED: 'TRUE',
      DEMOMART_PUBLIC_URL: 'http://demo.local:4000/',
    });
    expect(env.DEMO_STORES_EMBEDDED).toBe(true);
    expect(env.DEMOMART_PUBLIC_URL).toBe('http://demo.local:4000');
    expect(
      CollectorEnvSchema.safeParse({
        MONGODB_URI: 'mongodb://localhost',
        SCRAPER_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0)',
      }).success,
    ).toBe(false);
  });

  it('is exported alongside the shared EnvValidationError', () => {
    expect(new EnvValidationError(['MONGODB_URI: Required']).message).toContain('MONGODB_URI');
  });
});

describe('redactMongoUri', () => {
  it.each([
    [
      'mongodb+srv://user:secret@cluster0.ab1cd.mongodb.net/?retryWrites=true',
      'mongodb+srv://***@cluster0.ab1cd.mongodb.net/?retryWrites=true',
    ],
    ['mongodb://user:secret@h1:27017,h2:27017/db', 'mongodb://***@h1:27017,h2:27017/db'],
    ['mongodb://localhost:27017', 'mongodb://localhost:27017'],
  ])('%s', (input, expected) => {
    expect(redactMongoUri(input)).toBe(expected);
  });
});

describe('describeClusterType', () => {
  it('recognizes replica sets, mongos and standalone servers', () => {
    expect(describeClusterType({ setName: 'atlas-x-shard-0' })).toBe(
      'replica set "atlas-x-shard-0"',
    );
    expect(describeClusterType({ msg: 'isdbgrid' })).toBe('sharded cluster (mongos)');
    expect(describeClusterType({})).toBe('standalone');
  });
});
