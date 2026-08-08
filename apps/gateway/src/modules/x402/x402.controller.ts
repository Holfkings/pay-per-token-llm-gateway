import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { X402Service } from './x402.service';
import { RoutesService } from '../routes/routes.service';
import { PaymentsService } from '../payments/payments.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { verifyPaymentSchema } from '@x402/validation';
import { logger } from '@x402/logger';

@ApiTags('x402')
@Controller('x402')
export class X402Controller {
  constructor(
    private readonly x402Service: X402Service,
    private readonly routesService: RoutesService,
    private readonly paymentsService: PaymentsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Verify a payment for a specific quote.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(@Body() body: { txHash: string; quoteId: string }) {
    const parsed = verifyPaymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors);
    }

    const { txHash, quoteId } = parsed.data;

    // Look up the quote from cache/payment store
    const storedPayment = await this.paymentsService.findByQuoteId(quoteId);
    if (!storedPayment) {
      throw new BadRequestException('Quote not found or expired');
    }

    const quote = storedPayment.receiptJson as any;
    const verification = await this.x402Service.verifyPayment(txHash, quote);

    if (verification.verified) {
      await this.paymentsService.confirmPayment(quoteId, verification);
    }

    return verification;
  }

  /**
   * Get payment status for a quote.
   */
  @Get('status/:quoteId')
  @ApiOperation({ summary: 'Get payment status for a quote' })
  @ApiParam({ name: 'quoteId', type: 'string' })
  async getPaymentStatus(@Param('quoteId') quoteId: string) {
    const payment = await this.paymentsService.findByQuoteId(quoteId);
    if (!payment) {
      throw new BadRequestException('Quote not found');
    }

    return {
      quoteId,
      status: payment.status,
      txHash: payment.txHash,
      verifiedAt: payment.verifiedAt,
    };
  }
}
