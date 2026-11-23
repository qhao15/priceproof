import { describe, expect, it } from 'vitest';
import { detectBrand, productSearchText } from './brand.js';

describe('detectBrand', () => {
  it('finds the first known brand alias', () => {
    expect(detectBrand('Laptop Kestrel Air 14 KA14-512')).toBe('kestrel');
    expect(detectBrand('Điện thoại iPhone 16 Pro')).toBe('apple');
    expect(detectBrand('Màn hình LG Gram 16')).toBe('lg');
    expect(detectBrand('Tai nghe không thương hiệu')).toBeNull();
  });
});

describe('productSearchText', () => {
  it('normalizes the name and appends the brand', () => {
    expect(productSearchText('Laptop Kestrel Air 14 KA14-512', 'kestrel')).toBe(
      'laptop kestrel air 14 ka14 512 kestrel',
    );
    expect(productSearchText('Điện thoại X', null)).toBe('dien thoai x');
  });
});
