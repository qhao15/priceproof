import { z } from 'zod';

/** Product categories in scope for v1 (SPEC §1.5). */
export const CATEGORY_KEYS = ['phone', 'laptop', 'headphones'] as const;

export const CategoryKeySchema = z.enum(CATEGORY_KEYS);

export type CategoryKey = z.infer<typeof CategoryKeySchema>;

export function isCategoryKey(value: unknown): value is CategoryKey {
  return CategoryKeySchema.safeParse(value).success;
}
