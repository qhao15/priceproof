import { DB_NAME, EnvValidationError } from '@priceproof/shared';
import { createMongoClient, describeClusterType, redactMongoUri } from '../db/client.js';
import { loadCollectorEnv } from '../env.js';
import { print, printError } from './output.js';

/** `pnpm db:ping`: connects to MONGODB_URI and prints the server version and cluster type. */
async function main(): Promise<number> {
  let uri: string;
  try {
    uri = loadCollectorEnv().MONGODB_URI;
  } catch (error) {
    if (error instanceof EnvValidationError) {
      printError(error.message);
      printError('Copy .env.example to .env and set MONGODB_URI to the Atlas dev cluster.');
      return 1;
    }
    throw error;
  }

  const client = createMongoClient(uri);
  print(`Connecting to ${redactMongoUri(uri)} ...`);
  try {
    await client.connect();
    const admin = client.db('admin');
    const buildInfo = await admin.command({ buildInfo: 1 });
    const hello = await admin.command({ hello: 1 });
    await client.db(DB_NAME).command({ ping: 1 });
    print('Connected.');
    print(`  Server version: ${String(buildInfo.version)}`);
    print(`  Cluster type:   ${describeClusterType(hello)}`);
    print(`  Database:       ${DB_NAME}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Could not connect: ${message}`);
    printError(hintFor(message));
    return 1;
  } finally {
    await client.close();
  }
}

function hintFor(message: string): string {
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'Hint: DNS lookup of the cluster failed. Check the host name, or try another DNS server.';
  }
  if (/auth|credentials/i.test(message)) {
    return 'Hint: check the database user name and password in MONGODB_URI.';
  }
  if (/timed out|Server selection/i.test(message)) {
    return "Hint: add this computer's IP address in Atlas → Network Access.";
  }
  return 'Hint: check MONGODB_URI and the Atlas cluster status.';
}

process.exitCode = await main();
