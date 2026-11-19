import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EnvValidationError } from '@priceproof/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { type ApiEnv, loadApiEnv } from './config/env.js';

let env: ApiEnv;
try {
  env = loadApiEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
    process.exit(1);
  }
  throw error;
}

const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
  bufferLogs: true,
});
configureApp(app);
await app.listen(env.PORT);
