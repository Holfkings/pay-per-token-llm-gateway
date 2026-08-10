import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getConfig } from '@x402/config';
import { AdminService } from './admin.service';

/**
 * Hourly maintenance job: expires pending payments whose quote window has
 * passed so the Payment table doesn't accumulate stale rows indefinitely.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly adminService: AdminService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpireStalePayments() {
    try {
      const config = getConfig();
      const count = await this.adminService.expireStalePayments(config.payment.quoteExpirySeconds);
      if (count > 0) {
        this.logger.log(`Cleanup: expired ${count} stale pending payments`);
      }
    } catch (error) {
      this.logger.error('Cleanup job failed', String(error));
    }
  }
}
