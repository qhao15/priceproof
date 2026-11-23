import { parseArgs } from 'node:util';
import { pino } from 'pino';
import { createContext } from '../context.js';
import { backfillDemo } from '../demo/demo-tools.js';
import { cliEnv, withDb } from './common.js';
import { print, printError } from './output.js';

/** `pnpm demo:backfill --days 90` (SPEC §14.6). Run it after the first category crawls. */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { days: { type: 'string', default: '90' } } });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    printError('--days must be an integer from 1 to 365');
    return 1;
  }
  const env = cliEnv();
  if (!env) return 1;
  return withDb(env, async (db) => {
    const ctx = createContext(db, pino({ level: env.LOG_LEVEL }));
    try {
      const r = await backfillDemo(ctx, { days, timeScale: env.DEMO_TIME_SCALE });
      print(
        `Backfilled ${r.listings} demo listings with ${r.points} price points (${r.skipped} skipped).`,
      );
      if (r.listings === 0 && r.skipped === 0) {
        print('No demo listings yet: run the collector first (pnpm collector:once --minutes 5).');
      }
      return 0;
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      return 1;
    }
  });
}

process.exitCode = await main();
