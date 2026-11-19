import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { ApiEnv } from './config/env.js';
import { API_ENV, APP_VERSION } from './config/tokens.js';
import { readApiVersion } from './config/version.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Health checks from Render arrive every few seconds; keep them out of the log.
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
          },
        }),
        HealthModule,
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: APP_VERSION, useValue: readApiVersion() },
      ],
      exports: [API_ENV, APP_VERSION],
    };
  }
}
