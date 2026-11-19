import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads the API version from apps/api/package.json (works from both src/ and dist/). */
export function readApiVersion(): string {
  const path = join(import.meta.dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}
