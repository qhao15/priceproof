import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  HealthResponseSchema,
  PageQuerySchema,
  pageSchema,
  ProblemDetailsSchema,
  sortSchema,
} from './index.js';

describe('HealthResponseSchema', () => {
  it('round-trips a health response', () => {
    const body = { ok: true, version: '0.1.0' };
    expect(HealthResponseSchema.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
  });

  it('rejects ok: false', () => {
    expect(HealthResponseSchema.safeParse({ ok: false, version: '0.1.0' }).success).toBe(false);
  });
});

describe('ProblemDetailsSchema', () => {
  it('accepts validation problems with field errors', () => {
    const body = {
      type: 'about:blank',
      title: 'Unprocessable Entity',
      status: 422,
      errors: { email: 'Invalid email' },
    };
    expect(ProblemDetailsSchema.parse(body)).toEqual(body);
  });

  it('rejects non-error statuses', () => {
    expect(ProblemDetailsSchema.safeParse({ type: 'x', title: 'OK', status: 200 }).success).toBe(
      false,
    );
  });
});

describe('PageQuerySchema', () => {
  it('applies defaults and coerces query strings', () => {
    expect(PageQuerySchema.parse({})).toEqual({ page: 0, size: 20 });
    expect(PageQuerySchema.parse({ page: '2', size: '50' })).toEqual({ page: 2, size: 50 });
  });

  it.each([{ page: '-1' }, { size: '0' }, { size: '101' }, { page: '1.5' }])(
    'rejects %o',
    (query) => {
      expect(PageQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('sortSchema', () => {
  const sort = sortSchema(['realDiscountPct', 'price'], 'realDiscountPct,desc');

  it('uses the default and parses whitelisted fields', () => {
    expect(sort.parse(undefined)).toEqual({ field: 'realDiscountPct', direction: 'desc' });
    expect(sort.parse('price,asc')).toEqual({ field: 'price', direction: 'asc' });
    expect(sort.parse('price')).toEqual({ field: 'price', direction: 'asc' });
  });

  it.each(['title,asc', 'price,up', ''])('rejects "%s"', (value) => {
    expect(sort.safeParse(value).success).toBe(false);
  });
});

describe('pageSchema', () => {
  it('validates a paged envelope', () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    const body = { items: [{ id: 'a' }], page: 0, size: 20, total: 1 };
    expect(schema.parse(body)).toEqual(body);
    expect(schema.safeParse({ ...body, total: -1 }).success).toBe(false);
  });
});
