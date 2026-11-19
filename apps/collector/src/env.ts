import {
  AppTimezoneSchema,
  loadRootEnv,
  LogLevelSchema,
  MongoUriSchema,
  NodeEnvSchema,
  validateEnv,
} from '@priceproof/shared';
import { z } from 'zod';

/** Collector environment (SPEC §15.6). Crawling, demo-store and email variables arrive in M1–M7. */
export const CollectorEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: LogLevelSchema,
  APP_TIMEZONE: AppTimezoneSchema,
  MONGODB_URI: MongoUriSchema,
});

export type CollectorEnv = z.infer<typeof CollectorEnvSchema>;

/** Loads the root .env in development, then validates (throws EnvValidationError). */
export function loadCollectorEnv(env: NodeJS.ProcessEnv = process.env): CollectorEnv {
  loadRootEnv({ env });
  return validateEnv(CollectorEnvSchema, env);
}
