import { z } from 'zod';
import { CategoryKeySchema } from '../categories.js';
import { MAX_VND_PRICE, MIN_VND_PRICE } from '../money/parse-vnd-price.js';
import { parseHttpUrl } from '../url/url-key.js';

const VndPriceSchema = z.number().int().min(MIN_VND_PRICE).max(MAX_VND_PRICE);

/**
 * One product (or variant) as parsed from a store page (SPEC §9.2).
 *
 * The object is strict on purpose: hard rule 1 (SPEC §3) allows only these fields, so an adapter
 * that tries to pass along anything else (images, descriptions, reviews…) fails validation.
 */
export const ScrapedItemSchema = z.strictObject({
  storeProductId: z.string().trim().min(1).max(200),
  url: z.string().refine((value) => parseHttpUrl(value) !== null, {
    message: 'Must be an absolute http(s) URL',
  }),
  title: z.string().trim().min(1).max(500),
  category: CategoryKeySchema,
  /** null when the store shows no price ("Liên hệ"). */
  price: VndPriceSchema.nullable(),
  listPrice: VndPriceSchema.nullable(),
  inStock: z.boolean(),
  variant: z
    .strictObject({
      color: z.string().trim().min(1).max(50).optional(),
      storageGb: z.number().int().positive().optional(),
      ramGb: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ScrapedItem = z.infer<typeof ScrapedItemSchema>;
