import {
  detectBrand,
  normalizeText,
  productSearchText,
  type ScrapedItem,
} from '@priceproof/shared';
import { ObjectId } from 'mongodb';
import type { CollectorContext } from '../context.js';

/**
 * Creates the canonical product for a new listing. Matching across stores arrives in M4; until
 * then every new listing gets its own auto-created product (SPEC §16 M2).
 */
export async function createAutoProduct(
  ctx: CollectorContext,
  item: ScrapedItem,
  now: Date,
): Promise<ObjectId> {
  const brand = detectBrand(item.title);
  const result = await ctx.col.products.insertOne({
    _id: new ObjectId(),
    category: item.category,
    brand,
    name: item.title,
    searchText: productSearchText(item.title, brand),
    matchKey: normalizeText(item.title),
    attrs: {
      ...(item.variant?.storageGb ? { storageGb: item.variant.storageGb } : {}),
      ...(item.variant?.ramGb ? { ramGb: item.variant.ramGb } : {}),
      tiers: [],
      modelCodes: [],
      numbers: [],
    },
    createdBy: 'auto',
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId;
}
