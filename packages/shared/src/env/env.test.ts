import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BooleanStringSchema,
  EnvValidationError,
  findWorkspaceRoot,
  loadRootEnv,
  LogLevelSchema,
  MongoUriSchema,
  PortSchema,
  validateEnv,
} from './env.js';

let root: string;
let nested: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'priceproof-env-'));
  nested = join(root, 'apps', 'api');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findWorkspaceRoot', () => {
  it('finds the folder holding pnpm-workspace.yaml', () => {
    expect(findWorkspaceRoot(nested)).toBe(root);
    expect(findWorkspaceRoot(root)).toBe(root);
  });
});

describe('loadRootEnv', () => {
  it('loads the root .env without overriding variables that are already set', () => {
    writeFileSync(join(root, '.env'), 'A=from-file\nB=from-file\n# comment\nC="quoted value"\n');
    const env: Record<string, string | undefined> = { B: 'real' };
    expect(loadRootEnv({ cwd: nested, env })).toBe(join(root, '.env'));
    expect(env).toEqual({ A: 'from-file', B: 'real', C: 'quoted value' });
  });

  it('does nothing in production', () => {
    writeFileSync(join(root, '.env'), 'A=from-file\n');
    const env: Record<string, string | undefined> = { NODE_ENV: 'production' };
    expect(loadRootEnv({ cwd: nested, env })).toBeNull();
    expect(env.A).toBeUndefined();
  });

  it('does nothing when there is no .env file', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadRootEnv({ cwd: nested, env })).toBeNull();
    expect(env).toEqual({});
  });
});

describe('validateEnv', () => {
  const schema = z.object({
    PORT: PortSchema.default(3000),
    LOG_LEVEL: LogLevelSchema,
    ENABLED: BooleanStringSchema.default(false),
    MONGODB_URI: MongoUriSchema,
  });

  it('parses and applies defaults, treating empty strings as unset', () => {
    const env = validateEnv(schema, {
      MONGODB_URI: 'mongodb://localhost',
      PORT: '',
      ENABLED: 'TRUE',
    });
    expect(env).toEqual({
      PORT: 3000,
      LOG_LEVEL: 'info',
      ENABLED: true,
      MONGODB_URI: 'mongodb://localhost',
    });
  });

  it('lists every problem in one error', () => {
    let error: unknown;
    try {
      validateEnv(schema, { PORT: 'abc', ENABLED: 'yes' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const issues = (error as EnvValidationError).issues.join('\n');
    expect(issues).toContain('PORT');
    expect(issues).toContain('ENABLED');
    expect(issues).toContain('MONGODB_URI');
  });

  it('rejects URIs that are not MongoDB URIs', () => {
    expect(() => validateEnv(schema, { MONGODB_URI: 'https://example.vn' })).toThrow(
      EnvValidationError,
    );
  });
});
