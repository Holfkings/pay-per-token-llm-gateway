// ──────────────────────────────────────────────
// @x402/shared — Shared utilities and helpers
// ──────────────────────────────────────────────

import { randomUUID } from 'crypto';

/** Generate a UUID v4 */
export function generateId(): string {
  return randomUUID();
}

/** Convert a Unix timestamp (seconds) to ISO string */
export function unixToISO(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

/** Get current Unix timestamp in seconds */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Sleep for a given number of milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a function with exponential backoff */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 500, maxDelayMs = 10000, onRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      onRetry?.(attempt, error as Error);
      await sleep(jitter);
    }
  }
  throw new Error('Retry failed');
}

/** Truncate a string with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/** Mask a sensitive string (e.g., API key) showing only last 4 chars */
export function maskSensitive(value: string, showChars = 4): string {
  if (value.length <= showChars) return '*'.repeat(value.length);
  return '*'.repeat(value.length - showChars) + value.slice(-showChars);
}

/** Format an amount in smallest unit to a human-readable string */
export function formatAmount(amount: string, decimals: number): string {
  const num = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const fraction = num % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

/** Parse a human-readable amount to smallest unit string */
export function parseAmount(amount: string, decimals: number): string {
  const [whole, fraction = ''] = amount.split('.');
  const padded = fraction.padEnd(decimals, '0');
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(padded)).toString();
}

/** Safe JSON parse with default value */
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return defaultValue;
  }
}

/** Check if a value is a valid Stellar address */
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}

/** Check if a value is a valid transaction hash */
export function isValidTxHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}
