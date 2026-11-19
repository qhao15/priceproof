import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Paging query parameters (SPEC §10.1): 0-based `page`, `size` up to 100. */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

/**
 * `sort=field,asc|desc` with a per-endpoint whitelist of fields.
 * Example: `sortSchema(['realDiscountPct', 'price'], 'realDiscountPct,desc')`.
 */
export function sortSchema<const F extends readonly [string, ...string[]]>(
  fields: F,
  defaultSort: `${F[number]},${'asc' | 'desc'}`,
) {
  const fieldSet = new Set<string>(fields);
  return z
    .string()
    .default(defaultSort)
    .transform((value, ctx) => {
      const [field = '', direction = 'asc'] = value.split(',');
      if (!fieldSet.has(field) || (direction !== 'asc' && direction !== 'desc')) {
        ctx.addIssue({
          code: 'custom',
          message: `Must be one of ${fields.join(', ')}, followed by ",asc" or ",desc"`,
        });
        return z.NEVER;
      }
      return { field: field as F[number], direction: direction as 'asc' | 'desc' };
    });
}

/** Paged response envelope: `{ items, page, size, total }`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(0),
    size: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

export type Page<T> = { items: T[]; page: number; size: number; total: number };
