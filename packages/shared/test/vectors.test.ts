import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText, parseVndPrice, urlKey } from '../src/index.js';

/** Shared test vectors (SPEC §18), stored as JSON so every consumer tests the same cases. */
interface Vector<I, O> {
  input: I;
  output: O;
}

function loadVectors<I, O>(file: string): Vector<I, O>[] {
  const path = join(import.meta.dirname, '..', 'test-vectors', file);
  return JSON.parse(readFileSync(path, 'utf8')) as Vector<I, O>[];
}

describe('§18.1 urlKey', () => {
  const vectors = loadVectors<string, string>('url-key.json');
  it('has vectors', () => expect(vectors.length).toBeGreaterThan(0));
  it.each(vectors)('$input → $output', ({ input, output }) => {
    expect(urlKey(input)).toBe(output);
  });
});

describe('§18.2 parseVndPrice', () => {
  const vectors = loadVectors<string, number | null>('parse-vnd-price.json');
  it('has vectors', () => expect(vectors.length).toBeGreaterThan(0));
  it.each(vectors)('"$input" → $output', ({ input, output }) => {
    expect(parseVndPrice(input)).toBe(output);
  });
});

describe('§18.3 normalizeText', () => {
  const vectors = loadVectors<string, string>('normalize-text.json');
  it('has vectors', () => expect(vectors.length).toBeGreaterThan(0));
  it.each(vectors)('$input → $output', ({ input, output }) => {
    expect(normalizeText(input)).toBe(output);
  });
});
