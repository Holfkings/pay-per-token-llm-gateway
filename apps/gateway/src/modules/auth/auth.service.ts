import { Injectable, Inject } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthStore, type AuthRedisLike } from '@x402/authentication';
import { getConfig } from '@x402/config';
import { logger } from '@x402/logger';

export interface AuthTokenPayload {
  sessionId: string;
  address: string;
  iat: number;
  exp: number;
}

@Injectable()
export class AuthService {
  private readonly authStore: AuthStore;

  constructor(@Inject('REDIS') redis: AuthRedisLike) {
    this.authStore = new AuthStore(redis);
  }

  /**
   * Create a challenge for wallet-based authentication.
   */
  async createChallenge(address: string) {
    const result = await this.authStore.createChallenge(address);
    logger.info('Auth challenge created', {
      challengeId: result.challengeId,
      address,
    });
    return result;
  }

  /**
   * Verify a signed challenge and return a JWT session token.
   * In development mode, accepts dev signatures for testing without wallet extensions.
   */
  async verifyChallenge(
    challengeId: string,
    address: string,
    signature: string,
  ): Promise<{
    verified: boolean;
    token?: string;
    error?: string;
  }> {
    const config = getConfig();

    // Dev-only auth bypass: accept `dev-sig-` prefixed signatures, which
    // authenticate as any wallet. Gated behind an explicit AUTH_DEV_MODE=true
    // flag — it is never implied by NODE_ENV, so a production deploy can't
    // accidentally enable it.
    const isDevSignature = config.security.authDevMode && this.isDevSignature(signature);

    const result = isDevSignature
      ? { verified: true as const }
      : await this.authStore.verifyChallenge(challengeId, address, signature);

    if (!result.verified) {
      logger.warn('Auth challenge verification failed', {
        challengeId,
        address,
        error: 'error' in result ? (result as { error?: string }).error : undefined,
      });
      return result;
    }

    // Create a session and sign a JWT
    const session = await this.authStore.createSession(address, config.security.sessionDuration);

    const payload: AuthTokenPayload = {
      sessionId: session.sessionId,
      address: session.address,
      iat: Math.floor(session.createdAt / 1000),
      exp: Math.floor(session.expiresAt / 1000),
    };

    const token = jwt.sign(payload, config.security.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'x402-gateway',
    });

    logger.info('Auth verified, session created', {
      sessionId: session.sessionId,
      address,
    });

    return { verified: true, token };
  }

  /**
   * True when the signature is a dev-mode signature. The dashboard dev
   * fallback base64-encodes `dev-sig-<address>-<timestamp>`, so check both
   * the raw prefix and the decoded form.
   */
  private isDevSignature(signature: string): boolean {
    if (signature.startsWith('dev-sig-')) return true;
    try {
      return Buffer.from(signature, 'base64').toString('utf-8').startsWith('dev-sig-');
    } catch {
      return false;
    }
  }

  /**
   * Validate a JWT token and return the session info.
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    address?: string;
    sessionId?: string;
    error?: string;
  }> {
    const config = getConfig();

    try {
      const payload = jwt.verify(token, config.security.jwtSecret, {
        issuer: 'x402-gateway',
      }) as AuthTokenPayload;

      // Validate the session in the store (Redis or in-memory)
      const session = await this.authStore.validateSession(payload.sessionId);
      if (!session) {
        return { valid: false, error: 'Session expired or not found' };
      }

      return {
        valid: true,
        address: payload.address,
        sessionId: payload.sessionId,
      };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return { valid: false, error: 'Token expired' };
      }
      return { valid: false, error: 'Invalid token' };
    }
  }

  /**
   * Destroy a session (logout).
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.authStore.destroySession(sessionId);
    logger.info('Session destroyed', { sessionId });
  }
}
