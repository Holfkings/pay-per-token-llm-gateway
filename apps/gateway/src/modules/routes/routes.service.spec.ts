import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoutesService, buildRoutePathCandidates } from './routes.service';
import type { RouteConfig } from '@x402/types';

// Mock @x402/database
jest.mock('@x402/database', () => ({
  prisma: {
    route: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    provider: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '@x402/database';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const WALLET = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F';
const OTHER_WALLET = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK4G';

/** Raw Prisma-shaped route row (toRouteConfig expects Date objects). */
function makeRoute(overrides: Partial<Record<string, unknown>> = {}): RouteConfig {
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
    createdAt: new Date() as unknown as string,
    updatedAt: new Date() as unknown as string,
    ...overrides,
  };
}

describe('RoutesService', () => {
  let service: RoutesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoutesService],
    }).compile();

    service = module.get<RoutesService>(RoutesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns only routes whose provider is owned by the wallet', async () => {
      (mockPrisma.route.findMany as jest.Mock).mockResolvedValue([makeRoute()]);

      const result = await service.findAll(WALLET);

      expect(mockPrisma.route.findMany).toHaveBeenCalledWith({
        where: { provider: { walletAddress: WALLET } },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('route-1');
    });

    it('combines the ownership scope with a providerId filter', async () => {
      (mockPrisma.route.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(WALLET, 'provider-1');

      expect(mockPrisma.route.findMany).toHaveBeenCalledWith({
        where: { provider: { walletAddress: WALLET }, providerId: 'provider-1' },
      });
    });
  });

  describe('findById', () => {
    it('returns a route owned by the wallet', async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(makeRoute());

      const result = await service.findById('route-1', WALLET);

      expect(mockPrisma.route.findFirst).toHaveBeenCalledWith({
        where: { id: 'route-1', provider: { walletAddress: WALLET } },
      });
      expect(result.id).toBe('route-1');
    });

    it("throws NotFoundException for another wallet's route", async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('route-other', OTHER_WALLET)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a route when the target provider is owned by the wallet', async () => {
      (mockPrisma.provider.findFirst as jest.Mock).mockResolvedValue({
        id: 'provider-1',
        walletAddress: WALLET,
      });
      (mockPrisma.route.create as jest.Mock).mockResolvedValue(makeRoute());

      const result = await service.create(
        {
          providerId: 'provider-1',
          path: '/v1/chat/completions',
          upstreamUrl: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4',
          pricingModel: 'flat',
        },
        WALLET,
      );

      expect(mockPrisma.provider.findFirst).toHaveBeenCalledWith({
        where: { id: 'provider-1', walletAddress: WALLET },
      });
      expect(mockPrisma.route.create).toHaveBeenCalled();
      expect(result.id).toBe('route-1');
    });

    it("rejects creating a route on another wallet's provider", async () => {
      (mockPrisma.provider.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(
          {
            providerId: 'provider-foreign',
            path: '/v1/chat/completions',
            upstreamUrl: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-4',
            pricingModel: 'flat',
          },
          OTHER_WALLET,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.route.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a route owned by the wallet', async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(makeRoute());
      (mockPrisma.route.update as jest.Mock).mockResolvedValue(makeRoute({ active: false }));

      const result = await service.update('route-1', { active: false }, WALLET);

      expect(mockPrisma.route.findFirst).toHaveBeenCalledWith({
        where: { id: 'route-1', provider: { walletAddress: WALLET } },
      });
      expect(result.active).toBe(false);
    });

    it("rejects updating another wallet's route", async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update('route-foreign', { active: false }, OTHER_WALLET),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.route.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a route owned by the wallet', async () => {
      (mockPrisma.route.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(service.delete('route-1', WALLET)).resolves.toBeUndefined();
      expect(mockPrisma.route.deleteMany).toHaveBeenCalledWith({
        where: { id: 'route-1', provider: { walletAddress: WALLET } },
      });
    });

    it("rejects deleting another wallet's route", async () => {
      (mockPrisma.route.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.delete('route-foreign', OTHER_WALLET)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByPathAndModel', () => {
    it('resolves an active route by path and model (public flow)', async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(makeRoute());

      const result = await service.findByPathAndModel('/v1/chat/completions', 'gpt-4');

      expect(mockPrisma.route.findFirst).toHaveBeenCalledWith({
        where: {
          path: { in: ['/v1/chat/completions', '/chat/completions'] },
          model: 'gpt-4',
          active: true,
        },
      });
      expect(result?.id).toBe('route-1');
    });

    it('resolves a /v1-configured route from a gateway-prefixed request path (regression: C2)', async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(makeRoute());

      const result = await service.findByPathAndModel('/api/v1/chat/completions', 'gpt-4');

      // The gateway prefix absorbs the /v1 — the service must still resolve
      // a route stored as /v1/chat/completions.
      expect(mockPrisma.route.findFirst).toHaveBeenCalledWith({
        where: {
          path: {
            in: ['/api/v1/chat/completions', '/chat/completions', '/v1/chat/completions'],
          },
          model: 'gpt-4',
          active: true,
        },
      });
      expect(result?.id).toBe('route-1');
    });

    it('returns null when no route matches', async () => {
      (mockPrisma.route.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.findByPathAndModel('/nope', 'nope');

      expect(result).toBeNull();
    });
  });

  describe('buildRoutePathCandidates', () => {
    it('expands a gateway-prefixed path to /v1 and bare forms', () => {
      expect(buildRoutePathCandidates('/api/v1/chat/completions')).toEqual([
        '/api/v1/chat/completions',
        '/chat/completions',
        '/v1/chat/completions',
      ]);
    });

    it('keeps a /v1 path and also offers the bare form', () => {
      expect(buildRoutePathCandidates('/v1/chat/completions')).toEqual([
        '/v1/chat/completions',
        '/chat/completions',
      ]);
    });

    it('adds the /v1 form to a bare path', () => {
      expect(buildRoutePathCandidates('/chat/completions')).toEqual([
        '/chat/completions',
        '/v1/chat/completions',
      ]);
    });

    it('does not duplicate candidates', () => {
      expect(buildRoutePathCandidates('/v1/chat/completions')).toHaveLength(2);
    });

    it('normalizes trailing slashes so prefixed routes still match', () => {
      expect(buildRoutePathCandidates('/api/v1/chat/completions/')).toEqual([
        '/api/v1/chat/completions',
        '/chat/completions',
        '/v1/chat/completions',
      ]);
    });
  });
});
