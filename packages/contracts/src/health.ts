import { z } from 'zod';

/** `GET /api/v1/health`: liveness only, never touches MongoDB (SPEC §10.1). */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
