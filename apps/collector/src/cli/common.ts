import { DB_NAME, EnvValidationError } from '@priceproof/shared';
import type { Db } from 'mongodb';
import { createMongoClient } from '../db/client.js';
import { type CollectorEnv, loadCollectorEnv } from '../env.js';
import { printError } from './output.js';

/** Loads and validates the env for a CLI script; prints the problem and returns null on error. */
export function cliEnv(): CollectorEnv | null {
  try {
    return loadCollectorEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      printError(error.message);
      printError('See .env.example for every variable.');
      return null;
    }
    throw error;
  }
}

/** Runs `fn` with a connected database and closes the client afterwards. Returns an exit code. */
export async function withDb(env: CollectorEnv, fn: (db: Db) => Promise<number>): Promise<number> {
  const client = createMongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    return await fn(client.db(DB_NAME));
  } catch (error) {
    printError(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await client.close();
  }
}

/** Formats rows as an aligned text table. */
export function table(rows: (string | number)[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? '').length)));
  return rows
    .map((r) =>
      r
        .map((cell, c) => String(cell).padEnd(widths[c]!))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function formatVnd(n: number | null): string {
  return n === null ? '–' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}₫`;
}
