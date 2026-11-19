import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@priceproof/contracts';
import { APP_VERSION } from '../config/tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_VERSION) private readonly version: string) {}

  /** Liveness for Render's health check. Never touches MongoDB (SPEC §10.1). */
  @Get()
  get(): HealthResponse {
    return { ok: true, version: this.version };
  }
}
