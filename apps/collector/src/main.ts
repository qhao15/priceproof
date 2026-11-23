import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { DB_NAME, EnvValidationError } from '@priceproof/shared';
import { startDemoStores, stopDemoStores } from 'demo-store';
import { pino } from 'pino';
import { createContext } from './context.js';
import { createMongoClient, redactMongoUri } from './db/client.js';
import { type CollectorEnv, loadCollectorEnv } from './env.js';
import { Collector } from './runtime/collector.js';
import { createAdapters } from './stores/registry.js';

/**
 * Collector entry point (SPEC §9.1):
 *   node dist/main.js --mode daemon          keeps running (`pnpm collector`)
 *   node dist/main.js --mode once --minutes N  time-boxed run (`pnpm collector:once`)
 */
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'daemon' },
    minutes: { type: 'string', default: '20' },
  },
});
const mode = values.mode === 'once' ? 'once' : 'daemon';
const minutes = Number(values.minutes);
if (values.mode !== 'once' && values.mode !== 'daemon') {
  process.stderr.write('--mode must be "daemon" or "once"\n');
  process.exit(1);
}
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 360) {
  process.stderr.write('--minutes must be a number from 1 to 360\n');
  process.exit(1);
}

let env: CollectorEnv;
try {
  env = loadCollectorEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
    process.exit(1);
  }
  throw error;
}

const logger = pino({ level: env.LOG_LEVEL, name: 'collector' });
const owner = process.env.GITHUB_RUN_ID
  ? `gha-${process.env.GITHUB_RUN_ID}`
  : `${hostname()}-${process.pid}`;
const client = createMongoClient(env.MONGODB_URI);

function portOf(url: string): number {
  const u = new URL(url);
  return Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
}

let collector: Collector | null = null;
let embedded = false;
try {
  await client.connect();
  logger.info({ mongo: redactMongoUri(env.MONGODB_URI), mode, owner }, 'connected to MongoDB');
  if (env.DEMO_STORES_EMBEDDED) {
    await startDemoStores({
      demoMartPort: portOf(env.DEMOMART_FETCH_URL),
      shopJsPort: portOf(env.SHOPJS_FETCH_URL),
      logger: logger.child({ name: 'demo-store' }),
    });
    embedded = true;
  }
  collector = new Collector({
    ctx: createContext(client.db(DB_NAME), logger),
    adapters: createAdapters(env),
    userAgent: env.SCRAPER_USER_AGENT,
    mode,
    owner,
    demoTimeScale: env.DEMO_TIME_SCALE,
  });

  if (mode === 'once') {
    await collector.runOnce(minutes);
  } else {
    const started = await collector.start();
    if (started === 'started') {
      await new Promise<void>((resolve) => {
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
          process.once(signal, () => {
            logger.info({ signal }, 'stopping');
            void collector!.shutdown().finally(resolve);
          });
        }
      });
    }
  }
} catch (error) {
  logger.fatal({ err: error }, 'collector crashed');
  process.exitCode = 1;
} finally {
  if (embedded) await stopDemoStores();
  await client.close();
}
