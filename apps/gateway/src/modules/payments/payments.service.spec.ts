import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import type { Quote, RouteConfig, PaymentVerification } from '@x402/types';

// Mock @x402/database
jest.mock('@x402/database', () => ({
  prisma: {
    payment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      aggregate: jest.fn(),
    },
  },
}));

import { prisma } from '@x402/database';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    route: '/v1/chat/completions',
    pricingModel: 'flat',
    amount: '1000000',
    asset: 'USDC',
    assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    paymentAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
    network: 'testnet',
    expiresAt: Date.now() / 1000 + 300,
    statusUrl: 'http://localhost:3000/api/v1/payments/quote-1/status',
    ...overrides,
  };
}

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    id: 'route-1',
    providerId: 'provider-1',
    path: '/v1/chat/completions',
    upstreamUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4',
    pricingModel: 'flat',
    flatPrice: '1000000',
    acceptedAssets: ['USDC'],
    rateLimit: 10,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeVerification(overrides: Partial<PaymentVerification> = {}): PaymentVerification {
  return {
    verified: true,
    txHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    payerAddress: 'GB4YJON6574K74SGHSKHPMBJDJPLBPYN4HPGGN2J5RFKMSNFSWLBYFRL',
    amount: '1000000',
    asset: 'USDC',
    ledger: 12345,
    timestamp: Date.now() / 1000,
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentsService],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('createPendingPayment', () => {
    it('creates a pending payment record', async () => {
      const quote = makeQuote();
      const route = makeRoute();

      (mockPrisma.payment.create as jest.Mock).mockResolvedValue({});

      await service.createPendingPayment(quote, route);

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quoteId: 'quote-1',
            routeId: 'route-1',
            providerId: 'provider-1',
            status: 'pending',
          }),
        }),
      );
    });
  });

  describe('confirmPayment', () => {
    it('confirms payment and returns receipt', async () => {
      const verification = makeVerification();

      (mockPrisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const receipt = await service.confirmPayment('quote-1', verification);

      expect(receipt.status).toBe('confirmed');
      expect(receipt.txHash).toBe(verification.txHash);
      expect(receipt.payerAddress).toBe(verification.payerAddress);
      expect(receipt.amount).toBe(verification.amount);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalled();
    });
  });

  describe('findByQuoteId', () => {
    it('finds payment by quote ID', async () => {
      const mockPayment = { id: 'pay-1', quoteId: 'quote-1', status: 'confirmed' };
      (mockPrisma.payment.findFirst as jest.Mock).mockResolvedValue(mockPayment);

      const result = await service.findByQuoteId('quote-1');

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({ where: { quoteId: 'quote-1' } });
      expect(result).toEqual(mockPayment);
    });

    it('returns null if not found', async () => {
      (mockPrisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.findByQuoteId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByTxHash', () => {
    it('finds payment by transaction hash', async () => {
      const txHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
      const mockPayment = { id: 'pay-1', txHash, status: 'confirmed' };
      (mockPrisma.payment.findFirst as jest.Mock).mockResolvedValue(mockPayment);

      const result = await service.findByTxHash(txHash);

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { txHash },
        }),
      );
      expect(result).toEqual(mockPayment);
    });
  });

  describe('findAll', () => {
    it('returns paginated payments', async () => {
      (mockPrisma.payment.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.payment.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe('getStats', () => {
    it('returns payment statistics', async () => {
      (mockPrisma.payment.count as jest.Mock)
        .mockResolvedValueOnce(10) // confirmed
        .mockResolvedValueOnce(12); // total
      (mockPrisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: BigInt('50000000') },
      });

      const stats = await service.getStats('provider-1');

      expect(stats.totalPayments).toBe(12);
      expect(stats.confirmedPayments).toBe(10);
      expect(stats.failedPayments).toBe(2);
      expect(stats.totalRevenue).toBe('50000000');
    });
  });
});
