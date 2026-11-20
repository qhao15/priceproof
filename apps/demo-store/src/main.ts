import { EnvValidationError, loadRootEnv } from '@priceproof/shared';
import { startDemoStores, stopDemoStores } from './server.js';

// Standalone demo stores for development (`pnpm dev`): DemoMart on 4000, ShopJS on 4001.
loadRootEnv();

try {
  await startDemoStores();
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
    process.exit(1);
  }
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    process.stderr.write(
      `Port already in use: ${(error as Error).message}\nIs another copy of the demo stores running?\n`,
    );
    process.exit(1);
  }
  throw error;
}

process.stdout.write(
  'Demo stores: DemoMart http://localhost:4000 · ShopJS http://localhost:4001\n',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stopDemoStores().then(() => process.exit(0));
  });
}
