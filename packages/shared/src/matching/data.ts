import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Folder of the matching data files (SPEC §8.3), next to `src/` and `dist/`. */
const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');

const cache = new Map<string, unknown>();

/** Reads a data file from `packages/shared/data` (cached). */
export function readDataFile<T>(name: string): T {
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')));
  }
  return cache.get(name) as T;
}
