import {
  AppTimezoneSchema,
  BooleanStringSchema,
  loadRootEnv,
  LogLevelSchema,
  MongoUriSchema,
  NodeEnvSchema,
  validateEnv,
} from '@priceproof/shared';
import { z } from 'zod';

const HttpUrlSchema = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ''));

/** Collector environment (SPEC §15.6). Email and AI variables arrive in M7 / when chosen. */
export const CollectorEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: LogLevelSchema,
  APP_TIMEZONE: AppTimezoneSchema,
  MONGODB_URI: MongoUriSchema,
  PUBLIC_WEB_URL: HttpUrlSchema.default('http://localhost:5173'),
  /** Honest bot identity sent with every request (hard rule). */
  SCRAPER_USER_AGENT: z
    .string()
    .min(10)
    .regex(/bot/i, 'Must identify the crawler as a bot')
    .default('PriceProofBot/1.0 (+http://localhost:5173/methodology#bot)'),
  DEMO_STORES_EMBEDDED: BooleanStringSchema.default(false),
  DEMOMART_PUBLIC_URL: HttpUrlSchema.default('http://localhost:4000'),
  DEMOMART_FETCH_URL: HttpUrlSchema.default('http://localhost:4000'),
  SHOPJS_PUBLIC_URL: HttpUrlSchema.default('http://localhost:4001'),
  SHOPJS_FETCH_URL: HttpUrlSchema.default('http://localhost:4001'),
  /** Read so demo categories are crawled more often when demo time runs faster. */
  DEMO_TIME_SCALE: z.coerce.number().positive().default(1),
});

export type CollectorEnv = z.infer<typeof CollectorEnvSchema>;

/** Loads the root .env in development, then validates (throws EnvValidationError). */
export function loadCollectorEnv(env: NodeJS.ProcessEnv = process.env): CollectorEnv {
  loadRootEnv({ env });
  return validateEnv(CollectorEnvSchema, env);
}
