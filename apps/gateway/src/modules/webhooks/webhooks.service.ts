import { Injectable } from '@nestjs/common';
import { dispatcher } from '@x402/notifications';
import { logger } from '@x402/logger';
import type { NotificationEvent } from '@x402/types';

@Injectable()
export class WebhooksService {
  /**
   * Dispatch a notification to all registered channels for a provider.
   */
  async notify(providerId: string, event: NotificationEvent, data: Record<string, unknown>) {
    try {
      const delivered = await dispatcher.dispatch({ providerId, event, data });
      logger.info('Notification dispatched', { providerId, event, channels: delivered });
      return { success: true, channels: delivered };
    } catch (error) {
      logger.error('Notification dispatch failed', { providerId, event, error: String(error) });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Send a payment received notification.
   */
  async notifyPaymentReceived(
    providerId: string,
    data: { txHash: string; amount: string; asset: string; payerAddress: string },
  ) {
    return this.notify(providerId, 'payment_received', data);
  }

  /**
   * Send a verification failure notification.
   */
  async notifyVerificationFailed(providerId: string, data: { txHash: string; reason: string }) {
    return this.notify(providerId, 'verification_failed', data);
  }

  /**
   * Send a request forwarded notification with a webhook payload.
   */
  async sendWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<boolean> {
    const { WebhookNotificationHandler } = await import('@x402/notifications');
    const handler = new WebhookNotificationHandler({ retryCount: 3, retryDelayMs: 1000 });
    return handler.send(
      {
        providerId: 'system',
        event: 'request_forwarded',
        data: payload,
      },
      webhookUrl,
    );
  }
}
