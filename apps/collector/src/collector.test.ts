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
    });
    expect(CollectorEnvSchema.safeParse({}).success).toBe(false);
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
