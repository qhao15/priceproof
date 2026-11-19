import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/index.js';

/** Sanity checks for the matching data files (SPEC §8.3), which are edited by hand. */
function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', file), 'utf8')) as T;
}

const brands = load<Record<string, string[]>>('brands.json');
const colors = load<Record<string, string[]>>('colors.json');
const noise = load<string[]>('noise.json');
const tiers = load<string[]>('tiers.json');
const usedMarkers = load<{ phrases: string[]; rawTitlePatterns: string[] }>('used-markers.json');

function expectNormalized(phrases: string[]): void {
  for (const phrase of phrases) {
    expect(normalizeText(phrase), `"${phrase}" must already be normalized`).toBe(phrase);
  }
}

function expectUnique(phrases: string[]): void {
  expect(new Set(phrases).size).toBe(phrases.length);
}

describe('brands.json', () => {
  it('maps canonical keys to normalized, unique aliases', () => {
    const aliases = Object.values(brands).flat();
    expectNormalized([...Object.keys(brands), ...aliases]);
    expectUnique(aliases);
  });

  it('includes every fictional demo brand', () => {
    for (const brand of ['novix', 'zentra', 'kestrel', 'corvane', 'auralis', 'orcana']) {
      expect(brands[brand]).toContain(brand);
    }
  });
});

describe('colors.json', () => {
  it('has normalized, unique phrases', () => {
    const phrases = Object.values(colors).flat();
    expectNormalized(phrases);
    expectUnique(phrases);
  });

  it('lists the longest phrase first within each color', () => {
    for (const phrases of Object.values(colors)) {
      const lengths = phrases.map((p) => p.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    }
  });
});

describe('noise.json, tiers.json, used-markers.json', () => {
  it('have normalized, unique entries', () => {
    for (const list of [noise, tiers, usedMarkers.phrases]) {
      expectNormalized(list);
      expectUnique(list);
    }
  });

  it('has valid raw-title patterns that catch "99%"', () => {
    const patterns = usedMarkers.rawTitlePatterns.map((p) => new RegExp(p, 'i'));
    expect(patterns.some((re) => re.test('Novix X5 Like new 99%'))).toBe(true);
    expect(patterns.some((re) => re.test('Novix X5 99 %'))).toBe(true);
    expect(patterns.some((re) => re.test('Novix X5 256GB'))).toBe(false);
  });
});
