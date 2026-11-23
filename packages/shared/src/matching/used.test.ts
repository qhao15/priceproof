import { describe, expect, it } from 'vitest';
import { canonicalColor } from './colors.js';
import { isUsedTitle } from './used.js';

describe('isUsedTitle', () => {
  it.each([
    ['Điện thoại Novix X5 Pro 12GB/256GB - Like new 99%', true],
    ['(Máy cũ) Novix 14 5G 128GB (8GB RAM)', true],
    ['Laptop Kestrel Air 14 - Hàng trưng bày', true],
    ['Zentra Z9 99 % pin', true],
    ['Điện thoại Novix X5 8GB/128GB - Chính hãng, Trả góp 0%', false],
    ['Tai nghe Auralis Pods 4 - Chính hãng', false],
  ])('%s → %s', (title, expected) => {
    expect(isUsedTitle(title)).toBe(expected);
  });
});

describe('canonicalColor', () => {
  it('maps Vietnamese and English names to color keys', () => {
    expect(canonicalColor('Xanh dương')).toBe('blue');
    expect(canonicalColor('Bạc')).toBe('silver');
    expect(canonicalColor('Space Gray')).toBe('gray');
    expect(canonicalColor('Titan')).toBe('titanium');
    expect(canonicalColor('Cầu vồng')).toBeNull();
    expect(canonicalColor('')).toBeNull();
  });
});
