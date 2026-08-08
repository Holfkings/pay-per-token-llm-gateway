import { Injectable } from '@nestjs/common';
import {
  recordEvent,
  getSummary,
  getTimeSeries,
  getEvents,
  type AnalyticsEvent,
} from '@x402/analytics';
import { logger } from '@x402/logger';
import type { AnalyticsSummary, TimeSeriesDataPoint } from '@x402/types';

@Injectable()
export class AnalyticsService {
  recordUnpaidRequest(route: string, providerId: string) {
    recordEvent({ type: 'request:unpaid', route, providerId });
  }

  recordPaidRequest(
    route: string,
    providerId: string,
    callerAddress: string,
    amount: string,
    asset: string,
    responseTime?: number,
  ) {
    recordEvent({
      type: 'request:paid',
      route,
      providerId,
      callerAddress,
      amount,
      asset,
      responseTime,
    });
  }

  recordPaymentVerified(
    route: string,
    providerId: string,
    callerAddress: string,
    amount: string,
    asset: string,
  ) {
    recordEvent({ type: 'payment:verified', route, providerId, callerAddress, amount, asset });
  }

  recordPaymentFailed(route: string, providerId: string, callerAddress: string) {
    recordEvent({ type: 'payment:failed', route, providerId, callerAddress });
  }

  recordForwarded(route: string, providerId: string, callerAddress: string, responseTime: number) {
    recordEvent({ type: 'request:forwarded', route, providerId, callerAddress, responseTime });
  }

  getSummary(providerId?: string): AnalyticsSummary {
    return getSummary(providerId);
  }

  getTimeSeries(
    providerId: string,
    intervalMinutes?: number,
    durationHours?: number,
  ): TimeSeriesDataPoint[] {
    return getTimeSeries(providerId, intervalMinutes, durationHours);
  }

  getEvents(filter?: { providerId?: string; type?: string; limit?: number }): AnalyticsEvent[] {
    return getEvents(filter);
  }
}
