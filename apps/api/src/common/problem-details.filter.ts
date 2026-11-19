import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@priceproof/contracts';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

/** Turns every error into RFC 9457 Problem Details (SPEC §10.1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = toProblem(exception, request.originalUrl);
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}

export function toProblem(exception: unknown, instance?: string): ProblemDetails {
  const status =
    exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
  };
  if (instance) {
    problem.instance = instance;
  }
  // Never leak internal error messages; HttpExceptions carry messages meant for clients.
  if (exception instanceof HttpException) {
    const detail = detailOf(exception.getResponse());
    if (detail && detail !== problem.title) {
      problem.detail = detail;
    }
  }
  return problem;
}

function detailOf(body: string | object): string | undefined {
  if (typeof body === 'string') {
    return body;
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((m): m is string => typeof m === 'string').join('; ');
  }
  return undefined;
}
