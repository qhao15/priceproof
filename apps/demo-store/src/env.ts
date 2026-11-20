import { LogLevelSchema, NodeEnvSchema, validateEnv } from '@priceproof/shared';
import { z } from 'zod';

/** Fault switches for testing the collector's error handling (SPEC §14.5). */
export const DEMO_FAULTS = ['errors5pct', 'layoutV2', 'block429', 'captcha'] as const;
export type DemoFault = (typeof DEMO_FAULTS)[number];

const FaultListSchema = z
  .string()
  .default('')
  .transform((csv) =>
    csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(z.array(z.enum(DEMO_FAULTS)));

/** Demo store environment (SPEC §15.6). */
export const DemoEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: LogLevelSchema,
  /** With 60, one real minute is one simulated hour (development only). */
  DEMO_TIME_SCALE: z.coerce.number().positive().max(10_000).default(1),
  /** Freezes the simulated clock at this time, for deterministic tests. */
  DEMO_FIXED_NOW: z.iso.datetime({ offset: true }).optional(),
  DEMO_FAULTS: FaultListSchema,
});

export type DemoEnv = z.infer<typeof DemoEnvSchema>;

/** Validates the demo store variables (throws EnvValidationError). */
export function parseDemoEnv(env: NodeJS.ProcessEnv = process.env): DemoEnv {
  return validateEnv(DemoEnvSchema, env);
}
