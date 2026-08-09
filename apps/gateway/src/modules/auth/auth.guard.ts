import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid authorization format. Use: Bearer <token>');
    }

    const token = parts[1];
    const result = await this.authService.validateToken(token);

    if (!result.valid) {
      throw new UnauthorizedException(result.error);
    }

    // Attach authenticated address to the request for downstream use
    Object.assign(request, {
      authenticatedAddress: result.address,
      sessionId: result.sessionId,
    });

    return true;
  }
}
