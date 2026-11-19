import { Long } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { fromMongoMoney, toMongoMoney, toMongoMoneyOrNull } from './mongo-money.js';
import { parseVndPrice } from './parse-vnd-price.js';

describe('toMongoMoney', () => {
  it('writes integer VND as Int64', () => {
    const value = toMongoMoney(20_000_000);
    expect(value).toBeInstanceOf(Long);
    expect(value.toNumber()).toBe(20_000_000);
  });

  it.each([1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (amount) => {
    expect(() => toMongoMoney(amount)).toThrow(RangeError);
  });

  it('passes null through when optional', () => {
    expect(toMongoMoneyOrNull(null)).toBeNull();
    expect(toMongoMoneyOrNull(1000)?.toNumber()).toBe(1000);
  });
});

describe('fromMongoMoney', () => {
  it('reads numbers and Int64 values', () => {
    expect(fromMongoMoney(990_000)).toBe(990_000);
    expect(fromMongoMoney(Long.fromNumber(990_000))).toBe(990_000);
  });

  it('rejects values outside the safe integer range', () => {
    expect(() => fromMongoMoney(Long.MAX_VALUE)).toThrow(RangeError);
  });
});

describe('parseVndPrice (beyond the §18 vectors)', () => {
  it.each([
    ['1290000', 1_290_000],
    ['  25.000.000 ₫  ', 25_000_000],
    ['Giá khuyến mãi: 7.490.000đ', 7_490_000],
  ])('"%s" → %s', (input, expected) => {
    expect(parseVndPrice(input)).toBe(expected);
  });

  it.each([
    ['decimal-looking numbers', '12.99'],
    ['malformed groups', '1.2345.000₫'],
    ['a leading group over 3 digits', '1290.000₫'],
    ['below 1.000', '990₫'],
    ['above 2.000.000.000', '2.000.000.001₫'],
    ['a price and a percentage', '12.990.000₫ -20%'],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s', (_label, input) => {
    expect(parseVndPrice(input)).toBeNull();
  });
});
