import { parseArgs } from 'node:util';
import { DEAL_LABELS } from '@priceproof/shared';
import { getTruth } from 'demo-store';
import { collections } from '../context.js';
import { evaluateDemoLabels, pickEvent } from '../demo/demo-tools.js';
import { cliEnv, table, withDb } from './common.js';
import { print } from './output.js';

/**
 * `pnpm demo:eval [--event <id>]`: computed deal labels of demo listings per ground-truth
 * scenario. During an event, honest listings should mostly be `real_discount` and inflated ones
 * `smaller_than_advertised` or `no_real_discount`.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { event: { type: 'string' } } });
  const env = cliEnv();
  if (!env) return 1;
  return withDb(env, async (db) => {
    const col = collections(db);
    const truth = getTruth();
    const event = pickEvent(truth, new Date(), values.event);
    const listings = await col.listings
      .find({ storeId: { $in: ['demomart', 'shopjs'] }, status: 'active' })
      .project<{
        storeId: string;
        storeProductId: string;
        stats: { dealLabel: (typeof DEAL_LABELS)[number] };
      }>({
        storeId: 1,
        storeProductId: 1,
        'stats.dealLabel': 1,
      })
      .toArray();
    const { rows, unmatched } = evaluateDemoLabels(
      listings.map((l) => ({
        storeId: l.storeId,
        storeProductId: l.storeProductId,
        dealLabel: l.stats.dealLabel,
      })),
      event.id,
      truth,
    );
    print(`Event: ${event.name} (${event.startsAt} → ${event.endsAt})`);
    print(
      `Demo listings: ${listings.length}${unmatched ? ` (${unmatched} not in the ground truth)` : ''}\n`,
    );
    print(
      table([
        ['scenario', 'total', ...DEAL_LABELS],
        ...rows.map((r) => [r.scenario, r.total, ...DEAL_LABELS.map((d) => r.counts[d])]),
      ]),
    );
    return 0;
  });
}

process.exitCode = await main();
