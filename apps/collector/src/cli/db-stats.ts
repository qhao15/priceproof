import { COLLECTIONS, DEAL_LABELS } from '@priceproof/shared';
import { collections } from '../context.js';
import { cliEnv, table, withDb } from './common.js';
import { print } from './output.js';

/** Warn above this database size (the Atlas free cluster has 512 MB). */
const WARN_BYTES = 350 * 1024 * 1024;

/**
 * `pnpm db:stats` (SPEC §9.11): listings per store and status, last observation, last collector
 * run, label distribution, pending match candidates, suspicious prices and database size.
 */
async function main(): Promise<number> {
  const env = cliEnv();
  if (!env) return 1;
  return withDb(env, async (db) => {
    const col = collections(db);
    const perStore = await col.listings
      .aggregate<{ _id: { storeId: string; status: string }; n: number; lastSeen: Date }>([
        {
          $group: {
            _id: { storeId: '$storeId', status: '$status' },
            n: { $sum: 1 },
            lastSeen: { $max: '$lastSeenAt' },
          },
        },
        { $sort: { '_id.storeId': 1, '_id.status': 1 } },
      ])
      .toArray();
    const stores = await col.stores.find().toArray();
    print('Stores');
    print(
      table([
        ['store', 'enabled', 'health', 'listings (status)', 'last observation'],
        ...stores.map((s) => {
          const rows = perStore.filter((r) => r._id.storeId === s._id);
          const last = rows.reduce<Date | null>(
            (d, r) => (!d || r.lastSeen > d ? r.lastSeen : d),
            null,
          );
          return [
            s._id,
            s.enabled ? 'yes' : 'no',
            s.health.status + (s.health.pausedReason ? ` (${s.health.pausedReason})` : ''),
            rows.map((r) => `${r.n} ${r._id.status}`).join(', ') || '0',
            last?.toISOString() ?? '–',
          ];
        }),
      ]),
    );

    const labels = await col.listings
      .aggregate<{ _id: string; n: number }>([
        { $match: { status: 'active' } },
        { $group: { _id: '$stats.dealLabel', n: { $sum: 1 } } },
      ])
      .toArray();
    print('\nDeal labels (active listings)');
    print(
      table([
        ['label', 'listings'],
        ...DEAL_LABELS.map((l) => [l, labels.find((x) => x._id === l)?.n ?? 0]),
      ]),
    );

    const state = await col.systemState.findOne({ _id: 'collector' });
    const pending = await db
      .collection(COLLECTIONS.matchCandidates)
      .countDocuments({ status: 'pending' });
    const suspicious = await col.listings.countDocuments({ pendingSuspicious: { $ne: null } });
    const changes = await col.priceChanges.estimatedDocumentCount();
    print('\nCollector');
    print(
      table([
        [
          'last run',
          `${state?.lastRunMode ?? '–'} ${state?.lastRunStartedAt?.toISOString() ?? ''} → ${state?.lastRunFinishedAt?.toISOString() ?? '–'}`,
        ],
        [
          'lock',
          state?.lockOwner ? `${state.lockOwner} until ${state.lockUntil.toISOString()}` : 'free',
        ],
        ['price changes', changes],
        ['pending match candidates', pending],
        ['suspicious prices', suspicious],
      ]),
    );

    const s = (await db.stats()) as { dataSize: number; storageSize: number; indexSize: number };
    const total = s.storageSize + s.indexSize;
    print(
      `\nDatabase size: ${(total / 1024 / 1024).toFixed(1)} MB (data ${(s.dataSize / 1024 / 1024).toFixed(1)} MB)`,
    );
    if (total > WARN_BYTES) {
      print('WARNING: above 350 MB of the 512 MB free cluster. Check retention (SPEC §6.6).');
    }
    return 0;
  });
}

process.exitCode = await main();
