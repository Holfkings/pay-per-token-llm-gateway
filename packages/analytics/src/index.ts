// ──────────────────────────────────────────────
// @x402/analytics — Analytics types (persistence via Prisma in gateway)
// ──────────────────────────────────────────────

import type { StellarAddress } from '@x402/types';

export interface AnalyticsEvent {
  type:
    'request:paid' | 'request:unpaid' | 'payment:verified' | 'payment:failed' | 'request:forwarded';
  route: string;
  providerId: string;
  callerAddress?: StellarAddress;
  amount?: string;
  asset?: string;
  responseTime?: number;
}
