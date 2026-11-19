import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  HealthResponseSchema,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsSchema,
} from '@priceproof/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ApiEnvSchema } from '../src/config/env.js';
import { readApiVersion } from '../src/config/version.js';

let app: NestExpressApplication;

beforeAll(async () => {
  const env = ApiEnvSchema.parse({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('GET /api/v1/health', () => {
  it('returns ok and the API version, matching the shared contract', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(HealthResponseSchema.parse(res.body)).toEqual({ ok: true, version: readApiVersion() });
  });
});

describe('errors', () => {
  it('returns RFC 9457 Problem Details for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    const problem = ProblemDetailsSchema.parse(res.body);
    expect(problem).toMatchObject({ status: 404, title: 'Not Found', instance: '/api/v1/nope' });
  });

  it('serves nothing outside the global prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
