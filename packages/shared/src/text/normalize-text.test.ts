import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize-text.js';

describe('normalizeText (beyond the §18 vectors)', () => {
  it('makes diacritics irrelevant for search', () => {
    expect(normalizeText('Điện thoại')).toBe(normalizeText('dien thoai'));
    expect(normalizeText('ĐỒNG HỒ')).toBe('dong ho');
  });

  it('treats composed and decomposed input the same', () => {
    expect(normalizeText('Tiếng Việt'.normalize('NFD'))).toBe('tieng viet');
  });

  it('collapses punctuation and whitespace runs', () => {
    expect(normalizeText('  i5/16GB///512GB  -  (Bạc) ')).toBe('i5 16gb 512gb bac');
    expect(normalizeText('---')).toBe('');
  });
});
