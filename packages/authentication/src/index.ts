// ──────────────────────────────────────────────
// @x402/authentication — Wallet-based auth
// ──────────────────────────────────────────────

import { generateId } from '@x402/shared';
import { verifyChallenge } from '@x402/wallet';
import { logger } from '@x402/logger';
import type { StellarAddress } from '@x402/types';

// ── Challenge-Response Authentication ────────

interface ChallengeStore {
  [key: string]: {
    challenge: string;
    expiresAt: number;
    used: boolean;
  };
}

/** In-memory challenge store. In production, use Redis. */
const challenges: ChallengeStore = {};

/** Generate a new authentication challenge for a wallet address */
export function createAuthChallenge(address: StellarAddress): {
  challengeId: string;
  challenge: string;
} {
  const challengeId = generateId();
  const challenge = `x402-gateway-auth-${generateId()}-${Date.now()}`;

  challenges[challengeId] = {
    challenge,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
    used: false,
  };

  logger.debug('Created auth challenge', { challengeId, address });

  return { challengeId, challenge };
}

/** Verify a signed challenge response */
export function verifyAuthChallenge(
  challengeId: string,
  address: StellarAddress,
  signature: string,
): { verified: boolean; error?: string } {
  const record = challenges[challengeId];

  if (!record) {
    return { verified: false, error: 'Challenge not found' };
  }

  if (record.used) {
    return { verified: false, error: 'Challenge already used (replay protection)' };
  }

  if (Date.now() > record.expiresAt) {
    delete challenges[challengeId];
    return { verified: false, error: 'Challenge expired' };
  }

  const isValid = verifyChallenge(address, record.challenge, signature);

  if (isValid) {
    record.used = true;
    delete challenges[challengeId];
  }

  return { verified: isValid, error: isValid ? undefined : 'Invalid signature' };
}

// ── Session Management ───────────────────────

export interface Session {
  sessionId: string;
  address: StellarAddress;
  createdAt: number;
  expiresAt: number;
}

interface SessionStore {
  [sessionId: string]: Session;
}

/** In-memory session store. In production, use Redis or DB. */
const sessions: SessionStore = {};

/** Create a new session after successful authentication */
export function createSession(address: StellarAddress, sessionDurationSeconds = 86400): Session {
  const session: Session = {
    sessionId: generateId(),
    address,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionDurationSeconds * 1000,
  };

  sessions[session.sessionId] = session;
  return session;
}

/** Validate a session by ID */
export function validateSession(sessionId: string): Session | null {
  const session = sessions[sessionId];

  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete sessions[sessionId];
    return null;
  }

  return session;
}

/** Destroy a session */
export function destroySession(sessionId: string): void {
  delete sessions[sessionId];
}

/** Clean up expired sessions */
export function cleanupSessions(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, session] of Object.entries(sessions)) {
    if (now > session.expiresAt) {
      delete sessions[id];
      cleaned++;
    }
  }

  return cleaned;
}
