import { Injectable } from '@nestjs/common';
import { prisma } from '@x402/database';
import { logger } from '@x402/logger';
import type {
  Quote,
  PaymentVerification,
  PaymentReceipt,
  RouteConfig,
  PaymentRecord,
} from '@x402/types';

/** Serialized payment response with amount as string (for JSON-safe responses) */
export interface PaymentResponse {
  id: string;
  quoteId: string;
  txHash: string | null;
  payerAddress: string | null;
  amount: string;
  asset: string;
  status: string;
  verifiedAt: Date | null;
  routeId: string;
  providerId: string;
  createdAt: Date;
}

@Injectable()
export class PaymentsService {
  /**
   * Create a pending payment record when a quote is generated.
   */
  async createPendingPayment(quote: Quote, route: RouteConfig): Promise<void> {
    await prisma.payment.create({
      data: {
        quoteId: quote.id,
        routeId: route.id,
        providerId: route.providerId,
        txHash: null,
        payerAddress: null,
        amount: BigInt(quote.amount),
        asset: quote.asset,
        status: 'pending',
        receiptJson: quote as any,
      },
    });

    logger.info('Pending payment created', { quoteId: quote.id });
  }

  /**
   * Confirm a payment after successful verification.
   */
  async confirmPayment(
    quoteId: string,
    verification: PaymentVerification,
  ): Promise<PaymentReceipt> {
    const receipt: PaymentReceipt = {
      id: quoteId,
      quoteId,
      txHash: verification.txHash,
      payerAddress: verification.payerAddress,
      amount: verification.amount,
      asset: verification.asset,
      route: '',
      status: 'confirmed',
      verifiedAt: new Date(verification.timestamp * 1000).toISOString(),
      ledger: verification.ledger,
    };

    await prisma.payment.updateMany({
      where: { quoteId },
      data: {
        txHash: verification.txHash,
        payerAddress: verification.payerAddress,
        status: 'confirmed',
        verifiedAt: new Date(verification.timestamp * 1000),
        ledger: verification.ledger,
        receiptJson: receipt as any,
      },
    });

    logger.info('Payment confirmed', { quoteId, txHash: verification.txHash });

    return receipt;
  }

  /**
   * Find a payment by quote ID.
   */
  async findByQuoteId(quoteId: string): Promise<PaymentRecord | null> {
    return prisma.payment.findFirst({ where: { quoteId } });
  }

  /**
   * Find a payment by transaction hash.
   */
  async findByTxHash(txHash: string): Promise<PaymentRecord | null> {
    return prisma.payment.findFirst({
      where: { txHash },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find all payments, with pagination and filtering.
   */
  async findAll(
    options: {
      providerId?: string;
      status?: string;
      payerAddress?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{
    data: PaymentResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const { providerId, status, payerAddress } = options;

    const where: any = {};
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    if (payerAddress) where.payerAddress = payerAddress;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where }),
    ]);

    // Serialize BigInt amounts to strings for JSON response
    const serialized: PaymentResponse[] = payments.map((p) => ({
      id: p.id,
      quoteId: p.quoteId,
      txHash: p.txHash,
      payerAddress: p.payerAddress,
      amount: p.amount.toString(),
      asset: p.asset,
      status: p.status,
      verifiedAt: p.verifiedAt,
      routeId: p.routeId,
      providerId: p.providerId,
      createdAt: p.createdAt,
    }));

    return {
      data: serialized,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get payment statistics for a provider.
   */
  async getStats(providerId: string) {
    const [confirmed, total, totalRevenue] = await Promise.all([
      prisma.payment.count({ where: { providerId, status: 'confirmed' } }),
      prisma.payment.count({ where: { providerId } }),
      prisma.payment.aggregate({
        where: { providerId, status: 'confirmed' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPayments: total,
      confirmedPayments: confirmed,
      failedPayments: total - confirmed,
      totalRevenue: totalRevenue._sum.amount?.toString() || '0',
    };
  }
}
