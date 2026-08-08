import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { getConfig } from '@x402/config';
import type { Redis } from 'ioredis';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const config = getConfig();

    // Identify the caller: prefer x-caller-address header, fall back to IP
    const callerId =
      (request.headers['x-caller-address'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      'unknown';

    const txHash = request.headers['x-payment-hash'] as string | undefined;

    if (txHash) {
      // Paid requests get a higher, separate rate limit
      const paidWindow = config.redis.rateLimitWindow * 2; // e.g. 120s
      const paidMax = config.redis.rateLimitMax * 10; // e.g. 100 requests/window
      return this.checkLimit(callerId, paidWindow, paidMax, 'paid');
    }

    // Unpaid requests: strict limit to prevent 402 quote-spam
    const unpaidWindow = config.redis.rateLimitWindow;
    const unpaidMax = config.redis.rateLimitMax;
    return this.checkLimit(callerId, unpaidWindow, unpaidMax, 'unpaid');
  }

  private async checkLimit(
    callerId: string,
    windowSeconds: number,
    maxRequests: number,
    tier: 'paid' | 'unpaid',
  ): Promise<boolean> {
    try {
      const key = `x402:ratelimit:${tier}:${callerId}`;
      const allowed = await this.evalRateLimit(key, windowSeconds, maxRequests);

      if (!allowed) {
        throw new HttpException(
          {
            status: 429,
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Max ${maxRequests} ${tier} requests per ${windowSeconds}s.`,
            retryAfter: windowSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      // Re-throw HTTP exceptions (like our 429) so they reach the client
      if (error instanceof HttpException) {
        throw error;
      }

      // Redis connectivity errors → fall through gracefully
      this.logger.warn('Rate limit check failed, allowing request', {
        callerId,
        tier,
        error: String(error),
      });
      return true;
    }
  }

  /**
   * Sliding window rate limit using a Redis sorted set with an atomic Lua script.
   */
  private async evalRateLimit(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local member = ARGV[3]
      local max_requests = tonumber(ARGV[4])
      local ttl = tonumber(ARGV[5])

      -- Evict entries outside the sliding window
      redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

      -- Count remaining entries
      local count = redis.call('ZCARD', key)

      if count >= max_requests then
        return 0
      end

      -- Add current request
      redis.call('ZADD', key, now, member)
      redis.call('EXPIRE', key, ttl)

      return 1
    `;

    const member = `${now}-${Math.random().toString(36).slice(2, 9)}`;
    const ttl = windowSeconds + 10;

    const result = (await this.redis.eval(
      script,
      1,
      key,
      now.toString(),
      windowStart.toString(),
      member,
      maxRequests.toString(),
      ttl.toString(),
    )) as number;

    return result === 1;
  }
}
