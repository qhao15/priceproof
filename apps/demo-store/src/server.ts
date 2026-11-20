import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { type Logger, pino } from 'pino';
import { createClock } from './clock.js';
import { type DemoFault, parseDemoEnv } from './env.js';
import type { StoreContext } from './stores/common.js';
import { createDemoMartApp } from './stores/demomart.js';
import { createShopJsApp } from './stores/shopjs.js';

export const DEFAULT_DEMOMART_PORT = 4000;
export const DEFAULT_SHOPJS_PORT = 4001;

export interface StartDemoStoresOptions {
  /** Default 4000. Use 0 for a random free port. */
  demoMartPort?: number;
  /** Default 4001. Use 0 for a random free port. */
  shopJsPort?: number;
  /** Interface to listen on. Default "127.0.0.1" (this computer only). */
  host?: string;
  /** Frozen simulated time. Default: `DEMO_FIXED_NOW`. `null` means "not frozen". */
  fixedNow?: Date | string | null;
  /** Default: `DEMO_TIME_SCALE`. */
  timeScale?: number;
  /** Default: `DEMO_FAULTS`. */
  faults?: readonly DemoFault[];
  /** Random source for `errors5pct`. Default `Math.random`. */
  random?: () => number;
  /** Default: a pino logger at `LOG_LEVEL`. */
  logger?: Logger;
  /** Where the `DEMO_*` defaults are read from. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface RunningDemoStores {
  demoMartUrl: string;
  shopJsUrl: string;
  demoMartPort: number;
  shopJsPort: number;
}

let running: { servers: Server[]; info: RunningDemoStores } | null = null;

function listen(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Starts both demo stores in this process (SPEC §14.7). Used by `pnpm dev`, by the collector
 * with `DEMO_STORES_EMBEDDED=true` and by tests. Only one pair can run per process.
 */
export async function startDemoStores(
  options: StartDemoStoresOptions = {},
): Promise<RunningDemoStores> {
  if (running) {
    throw new Error('The demo stores are already running in this process');
  }
  const env = parseDemoEnv(options.env ?? process.env);
  const fixed = options.fixedNow === undefined ? env.DEMO_FIXED_NOW : options.fixedNow;
  const fixedNow = fixed ? new Date(fixed) : null;
  if (fixedNow && Number.isNaN(fixedNow.getTime())) {
    throw new RangeError(`Invalid fixedNow: ${String(fixed)}`);
  }
  const ctx: StoreContext = {
    clock: createClock({ fixedNow, timeScale: options.timeScale ?? env.DEMO_TIME_SCALE }),
    faults: new Set(options.faults ?? env.DEMO_FAULTS),
    random: options.random ?? Math.random,
    logger: options.logger ?? pino({ level: env.LOG_LEVEL, name: 'demo-store' }),
  };
  const host = options.host ?? '127.0.0.1';
  const servers: Server[] = [];
  try {
    servers.push(
      await listen(createDemoMartApp(ctx), options.demoMartPort ?? DEFAULT_DEMOMART_PORT, host),
    );
    servers.push(
      await listen(createShopJsApp(ctx), options.shopJsPort ?? DEFAULT_SHOPJS_PORT, host),
    );
  } catch (error) {
    await Promise.all(servers.map(close));
    throw error;
  }
  const [demoMartPort, shopJsPort] = servers.map((s) => (s.address() as AddressInfo).port) as [
    number,
    number,
  ];
  const urlHost = host.includes(':') ? `[${host}]` : host;
  const info: RunningDemoStores = {
    demoMartUrl: `http://${urlHost}:${demoMartPort}`,
    shopJsUrl: `http://${urlHost}:${shopJsPort}`,
    demoMartPort,
    shopJsPort,
  };
  running = { servers, info };
  ctx.logger.info(
    {
      ...info,
      faults: [...ctx.faults],
      fixedNow: fixedNow?.toISOString() ?? null,
      timeScale: fixedNow ? null : (options.timeScale ?? env.DEMO_TIME_SCALE),
    },
    'demo stores started',
  );
  return info;
}

/** Stops the demo stores started by {@link startDemoStores}. Safe to call when none run. */
export async function stopDemoStores(): Promise<void> {
  const current = running;
  running = null;
  if (current) {
    await Promise.all(current.servers.map(close));
  }
}
