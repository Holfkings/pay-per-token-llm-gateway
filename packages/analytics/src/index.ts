// ──────────────────────────────────────────────
// @x402/analytics — Usage & revenue analytics
// ──────────────────────────────────────────────

import type { AnalyticsSummary, TimeSeriesDataPoint, StellarAddress } from '@x402/types';
import { logger } from '@x402/logger';

// ── In-Memory Analytics Store ────────────────

export interface AnalyticsEvent {
  type:
    'request:paid' | 'request:unpaid' | 'payment:verified' | 'payment:failed' | 'request:forwarded';
  route: string;
  providerId: string;
  callerAddress?: StellarAddress;
  amount?: string;
  asset?: string;
  timestamp: string;
  responseTime?: number;
}

const events: AnalyticsEvent[] = [];
const MAX_EVENTS = 100_000;

/**
 * Record an analytics event.
 */
export function recordEvent(event: Omit<AnalyticsEvent, 'timestamp'>): void {
  const fullEvent: AnalyticsEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  events.push(fullEvent);

  // Circular buffer: keep only the latest MAX_EVENTS
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/**
 * Get analytics summary for a provider (or all providers).
 */
export function getSummary(providerId?: string): AnalyticsSummary {
  const filtered = providerId ? events.filter((e) => e.providerId === providerId) : events;

  const paidRequests = filtered.filter((e) => e.type === 'request:paid');
  const unpaidRequests = filtered.filter((e) => e.type === 'request:unpaid');
  const allForwarded = filtered.filter((e) => e.type === 'request:forwarded');

  // Calculate total USDC revenue
  const totalRevenue = paidRequests
    .filter((e) => e.asset === 'USDC')
    .reduce((sum, e) => {
      try {
        return sum + BigInt(e.amount || '0');
      } catch {
        return sum;
      }
    }, BigInt(0))
    .toString();

  // Average response time
  const responseTimes = allForwarded
    .filter((e) => e.responseTime != null)
    .map((e) => e.responseTime!);
  const avgResponseTime =
    responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;

  // Success rate
  const successRate =
    filtered.length > 0 ? (paidRequests.length / Math.max(filtered.length, 1)) * 100 : 0;

  // Top callers
  const callerMap = new Map<StellarAddress, { totalSpent: bigint; requestCount: number }>();
  for (const e of paidRequests) {
    if (!e.callerAddress) continue;
    const existing = callerMap.get(e.callerAddress) || { totalSpent: BigInt(0), requestCount: 0 };
    try {
      existing.totalSpent += BigInt(e.amount || '0');
    } catch {
      /* skip */
    }
    existing.requestCount++;
    callerMap.set(e.callerAddress, existing);
  }
  const topCallers = Array.from(callerMap.entries())
    .map(([address, data]) => ({
      address,
      totalSpent: data.totalSpent.toString(),
      requestCount: data.requestCount,
    }))
    .sort((a, b) => Number(BigInt(b.totalSpent) - BigInt(a.totalSpent)))
    .slice(0, 10);

  // Top routes
  const routeMap = new Map<string, { requestCount: number; revenue: bigint }>();
  for (const e of paidRequests) {
    const existing = routeMap.get(e.route) || { requestCount: 0, revenue: BigInt(0) };
    existing.requestCount++;
    try {
      existing.revenue += BigInt(e.amount || '0');
    } catch {
      /* skip */
    }
    routeMap.set(e.route, existing);
  }
  const topRoutes = Array.from(routeMap.entries())
    .map(([path, data]) => ({
      path,
      requestCount: data.requestCount,
      revenue: data.revenue.toString(),
    }))
    .sort((a, b) => Number(BigInt(b.revenue) - BigInt(a.revenue)))
    .slice(0, 10);

  return {
    totalRequests: filtered.length,
    paidRequests: paidRequests.length,
    unpaidRequests: unpaidRequests.length,
    totalRevenue,
    revenueAsset: 'USDC',
    averageResponseTime: Math.round(avgResponseTime),
    successRate: Math.round(successRate * 100) / 100,
    topCallers,
    topRoutes,
  };
}

/**
 * Get time-series data for charts.
 */
export function getTimeSeries(
  providerId: string,
  intervalMinutes = 60,
  durationHours = 24,
): TimeSeriesDataPoint[] {
  const now = Date.now();
  const startTime = now - durationHours * 60 * 60 * 1000;
  const intervalMs = intervalMinutes * 60 * 1000;
  const buckets: Map<number, TimeSeriesDataPoint> = new Map();

  // Initialize buckets
  for (let t = startTime; t <= now; t += intervalMs) {
    buckets.set(t, {
      timestamp: new Date(t).toISOString(),
      paidRequests: 0,
      unpaidRequests: 0,
      revenue: '0',
      failedVerifications: 0,
    });
  }

  // Fill buckets from events
  const filtered = events.filter(
    (e) => e.providerId === providerId && new Date(e.timestamp).getTime() >= startTime,
  );

  for (const event of filtered) {
    const eventTime = new Date(event.timestamp).getTime();
    const bucketTime = startTime + Math.floor((eventTime - startTime) / intervalMs) * intervalMs;
    const bucket = buckets.get(bucketTime);
    if (!bucket) continue;

    switch (event.type) {
      case 'request:paid':
        bucket.paidRequests++;
        try {
          bucket.revenue = (BigInt(bucket.revenue) + BigInt(event.amount || '0')).toString();
        } catch {
          /* skip */
        }
        break;
      case 'request:unpaid':
        bucket.unpaidRequests++;
        break;
      case 'payment:failed':
        bucket.failedVerifications++;
        break;
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/**
 * Get the raw events for audit purposes.
 */
export function getEvents(
  options: {
    providerId?: string;
    type?: string;
    limit?: number;
    offset?: number;
  } = {},
): AnalyticsEvent[] {
  let filtered = [...events];

  if (options.providerId) {
    filtered = filtered.filter((e) => e.providerId === options.providerId);
  }
  if (options.type) {
    filtered = filtered.filter((e) => e.type === options.type);
  }

  const offset = options.offset || 0;
  const limit = options.limit || 100;

  return filtered.slice(offset, offset + limit);
}
