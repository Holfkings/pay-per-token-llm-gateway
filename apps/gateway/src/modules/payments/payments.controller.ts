import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all payments' })
  @ApiQuery({ name: 'providerId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'payerAddress', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @Query('providerId') providerId?: string,
    @Query('status') status?: string,
    @Query('payerAddress') payerAddress?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.paymentsService.findAll({ providerId, status, payerAddress, page, limit });
  }

  @Get(':quoteId/status')
  @ApiOperation({ summary: 'Get payment status by quote ID' })
  async getStatus(@Param('quoteId') quoteId: string) {
    const payment = await this.paymentsService.findByQuoteId(quoteId);
    if (!payment) {
      return { quoteId, status: 'not_found' as const };
    }
    return {
      quoteId: payment.quoteId,
      status: payment.status,
      txHash: payment.txHash || null,
      payerAddress: payment.payerAddress || null,
      amount: typeof payment.amount === 'bigint' ? payment.amount.toString() : payment.amount,
      asset: payment.asset,
      verifiedAt: payment.verifiedAt,
    };
  }
}
