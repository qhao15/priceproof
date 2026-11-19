import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';

export const GLOBAL_PREFIX = 'api/v1';

/** Settings shared by main.ts and the tests, so tests exercise the real app setup. */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter());
  // Behind Render's proxy: take the client IP from X-Forwarded-For (rate limits, SPEC §10.1).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.enableShutdownHooks();
}
