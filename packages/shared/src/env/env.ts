import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

type Env = Record<string, string | undefined>;

/** Walks up from `start` until it finds the folder that holds `pnpm-workspace.yaml`. */
export function findWorkspaceRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export interface LoadRootEnvOptions {
  /** Folder to start searching for the workspace root from. Default: `process.cwd()`. */
  cwd?: string;
  /** Environment to fill. Default: `process.env`. */
  env?: Env;
}

/**
 * Loads the monorepo's root `.env` file into the environment, in development only.
 * Variables that are already set win over the file. Does nothing when NODE_ENV is "production"
 * or the file does not exist.
 *
 * @returns the path of the file that was loaded, or null.
 */
export function loadRootEnv(options: LoadRootEnvOptions = {}): string | null {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === 'production') {
    return null;
  }
  const root = findWorkspaceRoot(options.cwd);
  if (!root) {
    return null;
  }
  const file = join(root, '.env');
  if (!existsSync(file)) {
    return null;
  }
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined && value !== undefined) {
      env[key] = value;
    }
  }
  return file;
}

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables with a Zod schema. Empty strings count as "not set", so
 * `AI_PROVIDER=` in a .env file falls back to the schema's default.
 *
 * @throws EnvValidationError listing every invalid or missing variable.
 */
export function validateEnv<S extends z.ZodType>(schema: S, env: Env = process.env): z.output<S> {
  const cleaned: Env = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') {
      cleaned[key] = value;
    }
  }
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

// Building blocks for each app's env schema.

export const NodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const LogLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

export const AppTimezoneSchema = z.string().default('Asia/Ho_Chi_Minh');

/** "true" / "false" (any case) → boolean. */
export const BooleanStringSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((value) => value === 'true');

export const PortSchema = z.coerce.number().int().min(1).max(65535);

export const MongoUriSchema = z
  .string()
  .regex(/^mongodb(\+srv)?:\/\//, 'Must start with mongodb:// or mongodb+srv://');
