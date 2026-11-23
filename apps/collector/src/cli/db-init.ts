import { DB_NAME, EnvValidationError, SALE_EVENT_SEEDS } from '@priceproof/shared';
import { createMongoClient, redactMongoUri } from '../db/client.js';
import { initDatabase } from '../db/init.js';
import { type CollectorEnv, loadCollectorEnv } from '../env.js';
import { storeDefinitions } from '../stores/definitions.js';
import { print, printError } from './output.js';

/** `pnpm db:init`: collections, validators, indexes and seeds (idempotent, SPEC §6.1). */
async function main(): Promise<number> {
  let env: CollectorEnv;
  try {
    env = loadCollectorEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      printError(error.message);
      return 1;
    }
    throw error;
  }
  const client = createMongoClient(env.MONGODB_URI);
  print(`Initializing database "${DB_NAME}" on ${redactMongoUri(env.MONGODB_URI)} ...`);
  try {
    await client.connect();
    const report = await initDatabase(client.db(DB_NAME), {
      stores: storeDefinitions(env),
      saleEvents: SALE_EVENT_SEEDS,
    });
    const list = (items: string[]) => (items.length > 0 ? items.join(', ') : 'none');
    print(`  Collections created:  ${list(report.createdCollections)}`);
    print(`  Validators updated:   ${list(report.updatedValidators)}`);
    print(`  Indexes ensured:      ${report.indexes}`);
    print(`  Stores inserted:      ${list(report.storesInserted)}`);
    print(`  Stores updated:       ${list(report.storesUpdated)}`);
    print(`  Sale events inserted: ${list(report.saleEventsInserted)}`);
    print('Done.');
    return 0;
  } catch (error) {
    printError(`db:init failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await client.close();
  }
}

process.exitCode = await main();
