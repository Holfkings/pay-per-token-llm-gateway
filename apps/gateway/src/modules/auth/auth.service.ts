import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import {
  createAuthChallenge,
  verifyAuthChallenge,
  createSession,
  validateSession,
  destroySession,
} from '@x402/authentication';
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
  /**
   * Create a challenge for wallet-based authentication.
   */
  createChallenge(address: string) {
    const result = createAuthChallenge(address);
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
  verifyChallenge(
    challengeId: string,
    address: string,
    signature: string,
  ): {
    verified: boolean;
    token?: string;
    error?: string;
  } {
    const config = getConfig();

    // Dev mode: accept dev-sig- prefixed signatures for testing
    const isDevSignature = config.nodeEnv === 'development' && signature.startsWith('dev-sig-');

    const result = isDevSignature
      ? { verified: true as const }
      : verifyAuthChallenge(challengeId, address, signature);

    if (!result.verified) {
      logger.warn('Auth challenge verification failed', {
        challengeId,
        address,
        error: 'error' in result ? (result as any).error : undefined,
      });
      return result;
    }

    // Create a session and sign a JWT
    const session = createSession(address, config.security.sessionDuration);

    const payload: AuthTokenPayload = {
      sessionId: session.sessionId,
      address: session.address,
      iat: Math.floor(session.createdAt / 1000),
      exp: Math.floor(session.expiresAt / 1000),
    };

    const token = jwt.sign(payload, config.security.jwtSecret);

    logger.info('Auth verified, session created', {
      sessionId: session.sessionId,
      address,
    });

    return { verified: true, token };
  }

  /**
   * Validate a JWT token and return the session info.
   */
  validateToken(token: string): {
    valid: boolean;
    address?: string;
    sessionId?: string;
    error?: string;
  } {
    const config = getConfig();

    try {
      const payload = jwt.verify(token, config.security.jwtSecret) as AuthTokenPayload;

      // Also validate the in-memory session
      const session = validateSession(payload.sessionId);
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
  destroySession(sessionId: string): void {
    destroySession(sessionId);
    logger.info('Session destroyed', { sessionId });
  }
}
