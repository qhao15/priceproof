import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('maps HttpExceptions with their status and client-facing message', () => {
    expect(toProblem(new BadRequestException('Email is required'), '/api/v1/x')).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Email is required',
      instance: '/api/v1/x',
    });
  });

  it('joins message arrays and skips a detail equal to the title', () => {
    expect(toProblem(new BadRequestException(['a', 'b'])).detail).toBe('a; b');
    expect(toProblem(new NotFoundException()).detail).toBeUndefined();
  });

  it('hides internal error messages behind a generic 500', () => {
    expect(toProblem(new Error('secret connection string'))).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  });
});
