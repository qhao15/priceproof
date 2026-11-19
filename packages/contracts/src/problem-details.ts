import { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 Problem Details, the body of every API error (SPEC §10.1). */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Validation errors: field path → message. */
  errors: z.record(z.string(), z.string()).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
