import { Injectable } from '@nestjs/common';
import { prisma } from '@x402/database';
import type { AnalyticsEvent } from '@x402/analytics';
import type { AnalyticsSummary, TimeSeriesDataPoint } from '@x402/types';

@Injectable()
export class AnalyticsService {
  /** Record an unpaid (402) request event. */
  async recordUnpaidRequest(route: string, providerId: string) {
    await prisma.analyticsEvent.create({
      data: { type: 'request:unpaid', route, providerId },
    });
  }

  /** Record a paid request with amount and response time. */
  async recordPaidRequest(
    route: string,
    providerId: string,
    callerAddress: string,
    amount: string,
    asset: string,
    responseTime?: number,
  ) {
    await prisma.analyticsEvent.create({
      data: {
        type: 'request:paid',
        route,
        providerId,
        callerAddress,
        amount: BigInt(amount),
        asset,
        responseTime,
      },
    });
  }

  /** Record a verified payment event. */
  async recordPaymentVerified(
    route: string,
    providerId: string,
    callerAddress: string,
    amount: string,
    asset: string,
  ) {
    await prisma.analyticsEvent.create({
      data: {
        type: 'payment:verified',
        route,
        providerId,
        callerAddress,
        amount: BigInt(amount),
        asset,
      },
    });
  }

  /** Record a failed payment verification. */
  async recordPaymentFailed(route: string, providerId: string, callerAddress: string) {
    await prisma.analyticsEvent.create({
      data: {
        type: 'payment:failed',
        route,
        providerId,
        callerAddress,
      },
    });
  }

  /** Record a forwarded request with response time. */
  async recordForwarded(
    route: string,
    providerId: string,
    callerAddress: string,
    responseTime: number,
  ) {
    await prisma.analyticsEvent.create({
      data: {
        type: 'request:forwarded',
        route,
        providerId,
        callerAddress,
        responseTime,
      },
    });
  }

  /**
   * Get analytics summary using Prisma aggregation queries.
   */
  async getSummary(providerId?: string): Promise<AnalyticsSummary> {
    const where = providerId ? { providerId } : {};

    const [totalCount, paidCount, unpaidCount, revenueResult, avgResponseResult] =
      await Promise.all([
        prisma.analyticsEvent.count({ where }),
        prisma.analyticsEvent.count({
          where: { ...where, type: 'request:paid' },
        }),
        prisma.analyticsEvent.count({
          where: { ...where, type: 'request:unpaid' },
        }),
        // Sum of amounts for paid USDC events
        prisma.analyticsEvent.aggregate({
          where: {
            ...where,
            type: 'request:paid',
            asset: 'USDC',
            amount: { not: null },
          },
          _sum: { amount: true },
        }),
        // Average response time from forwarded events
        prisma.analyticsEvent.aggregate({
          where: {
            ...where,
            type: 'request:forwarded',
            responseTime: { not: null },
          },
          _avg: { responseTime: true },
        }),
      ]);

    // Top callers: group by callerAddress
    const topCallerRows = await prisma.analyticsEvent.groupBy({
      by: ['callerAddress'],
      where: {
        ...where,
        type: 'request:paid',
        callerAddress: { not: null },
      },
      _count: { id: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });

    const topCallers = topCallerRows.map((row) => ({
      address: row.callerAddress!,
      totalSpent: (row._sum.amount || 0n).toString(),
      requestCount: row._count.id,
    }));

    // Top routes: group by route
    const topRouteRows = await prisma.analyticsEvent.groupBy({
      by: ['route'],
      where: { ...where, type: 'request:paid' },
      _count: { id: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });

    const topRoutes = topRouteRows.map((row) => ({
      path: row.route,
      requestCount: row._count.id,
      revenue: (row._sum.amount || 0n).toString(),
    }));

    return {
      totalRequests: totalCount,
      paidRequests: paidCount,
      unpaidRequests: unpaidCount,
      totalRevenue: (revenueResult._sum.amount || 0n).toString(),
      revenueAsset: 'USDC',
      averageResponseTime: Math.round(avgResponseResult._avg.responseTime || 0),
      successRate: totalCount > 0 ? Math.round((paidCount / totalCount) * 10000) / 100 : 0,
      topCallers,
      topRoutes,
    };
  }

  /**
   * Get time-series data using Prisma queries with time bucketing.
   */
  async getTimeSeries(
    providerId: string,
    intervalMinutes = 60,
    durationHours = 24,
  ): Promise<TimeSeriesDataPoint[]> {
    const now = new Date();
    const startTime = new Date(now.getTime() - durationHours * 60 * 60 * 1000);

    // Fetch all events in the time window
    const events = await prisma.analyticsEvent.findMany({
      where: {
        providerId,
        createdAt: { gte: startTime },
      },
      select: {
        type: true,
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Build time buckets
    const intervalMs = intervalMinutes * 60 * 1000;
    const buckets: Map<number, TimeSeriesDataPoint> = new Map();

    for (let t = startTime.getTime(); t <= now.getTime(); t += intervalMs) {
      buckets.set(t, {
        timestamp: new Date(t).toISOString(),
        paidRequests: 0,
        unpaidRequests: 0,
        revenue: '0',
        failedVerifications: 0,
      });
    }

    // Fill buckets from events
    for (const event of events) {
      const eventTime = event.createdAt.getTime();
      const bucketTime =
        startTime.getTime() +
        Math.floor((eventTime - startTime.getTime()) / intervalMs) * intervalMs;
      const bucket = buckets.get(bucketTime);
      if (!bucket) continue;

      switch (event.type) {
        case 'request:paid':
          bucket.paidRequests++;
          if (event.amount) {
            bucket.revenue = (BigInt(bucket.revenue) + event.amount).toString();
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
   * Get raw events for audit/debugging.
   */
  async getEvents(filter?: {
    providerId?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<AnalyticsEvent[]> {
    const rows = await prisma.analyticsEvent.findMany({
      where: {
        ...(filter?.providerId ? { providerId: filter.providerId } : {}),
        ...(filter?.type ? { type: filter.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: filter?.offset || 0,
      take: filter?.limit || 100,
    });

    return rows.map((r) => ({
      type: r.type as AnalyticsEvent['type'],
      route: r.route,
      providerId: r.providerId,
      callerAddress: r.callerAddress || undefined,
      amount: r.amount?.toString() || undefined,
      asset: r.asset || undefined,
      responseTime: r.responseTime || undefined,
    }));
  }
}
