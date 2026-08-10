import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/** Request augmented by AuthGuard with the authenticated wallet session. */
export interface AuthenticatedRequest extends Request {
  authenticatedAddress?: string;
  sessionId?: string;
}

/**
 * Parameter decorator that resolves the authenticated Stellar wallet address
 * from the request. Must be used on routes protected by {@link AuthGuard}.
 *
 * @example
 * @Get()
 * async findAll(@CurrentWallet() wallet: string) { ... }
 */
export const CurrentWallet = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const wallet = request.authenticatedAddress;
    if (!wallet) {
      throw new UnauthorizedException('No authenticated wallet found');
    }
    return wallet;
  },
);
