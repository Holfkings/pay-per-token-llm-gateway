import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global HTTP exception filter.
 *
 * - Ensures all errors use a consistent JSON format: { status, error, message, timestamp }
 * - Adds the `Retry-After` header on 429 Too Many Requests responses
 * - Includes validation `details` when available
 * - Sanitizes unexpected errors (500s) to avoid leaking internals
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // If the exception already has a structured response (like our 429 or 400),
      // use it directly; otherwise wrap the message.
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        body = {
          ...(exceptionResponse as Record<string, unknown>),
          timestamp: new Date().toISOString(),
        };
      } else {
        body = {
          status,
          error: HttpStatus[status] || 'Error',
          message: exceptionResponse,
          timestamp: new Date().toISOString(),
        };
      }

      // 429 Too Many Requests → add Retry-After header
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        const retryAfter = this.extractRetryAfter(body);
        if (retryAfter > 0) {
          response.setHeader('Retry-After', String(retryAfter));
        }
      }
    } else {
      // Unexpected / unhandled errors → 500
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      const message =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : (exception as Error).message || 'Internal server error';

      body = {
        status,
        error: 'Internal Server Error',
        message,
        timestamp: new Date().toISOString(),
      };

      this.logger.error('Unhandled exception', {
        path: request.url,
        method: request.method,
        error: String(exception),
        stack: (exception as Error).stack,
      });
    }

    // Log client errors (4xx) at warn level, server errors (5xx) at error level
    if (status >= 500) {
      this.logger.error(`HTTP ${status}`, {
        path: request.url,
        method: request.method,
        message: body.message,
      });
    } else if (status >= 400) {
      this.logger.warn(`HTTP ${status}`, {
        path: request.url,
        method: request.method,
        message: body.message,
      });
    }

    response.status(status).json(body);
  }

  /**
   * Extract the Retry-After value (in seconds) from the error body.
   * Looks for `retryAfter` in the response, or falls back to the
   * configured rate-limit window from config.
   */
  private extractRetryAfter(body: Record<string, unknown>): number {
    if (typeof body.retryAfter === 'number' && body.retryAfter > 0) {
      return body.retryAfter as number;
    }
    if (typeof body.retryAfter === 'string') {
      const parsed = parseInt(body.retryAfter, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    // Fallback: default 60 seconds
    return 60;
  }
}
