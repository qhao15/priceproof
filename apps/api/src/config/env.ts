import {
  AppTimezoneSchema,
  loadRootEnv,
  LogLevelSchema,
  NodeEnvSchema,
  PortSchema,
  validateEnv,
} from '@priceproof/shared';
import { z } from 'zod';

/** API environment (SPEC §15.6). More variables (MongoDB, JWT, seed users) arrive in M5. */
export const ApiEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  PORT: PortSchema.default(3000),
  LOG_LEVEL: LogLevelSchema,
  APP_TIMEZONE: AppTimezoneSchema,
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Loads the root .env in development, then validates (throws EnvValidationError). */
export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  loadRootEnv({ env });
  return validateEnv(ApiEnvSchema, env);
}
