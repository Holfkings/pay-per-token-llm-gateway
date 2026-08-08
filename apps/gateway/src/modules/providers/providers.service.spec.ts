import { Test, TestingModule } from '@nestjs/testing';
import { ProvidersService } from './providers.service';
import { NotFoundException } from '@nestjs/common';

// Mock @x402/database
jest.mock('@x402/database', () => ({
  prisma: {
    provider: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from '@x402/database';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('ProvidersService', () => {
  let service: ProvidersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProvidersService],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns all providers', async () => {
      const mockProviders = [
        {
          id: 'p-1',
          name: 'Provider 1',
          walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
          payoutWalletAddress: null,
          active: true,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          routes: [],
        },
      ];

      (mockPrisma.provider.findMany as jest.Mock).mockResolvedValue(mockProviders);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Provider 1');
      expect(result[0].active).toBe(true);
    });
  });

  describe('findById', () => {
    it('returns a provider by ID', async () => {
      const mockProvider = {
        id: 'p-1',
        name: 'Test Provider',
        walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
        payoutWalletAddress: null,
        active: true,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        routes: [],
      };

      (mockPrisma.provider.findUnique as jest.Mock).mockResolvedValue(mockProvider);

      const result = await service.findById('p-1');

      expect(result.name).toBe('Test Provider');
      expect(result.id).toBe('p-1');
    });

    it('throws NotFoundException for missing provider', async () => {
      (mockPrisma.provider.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a new provider', async () => {
      const mockCreated = {
        id: 'new-id',
        name: 'New Provider',
        walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
        payoutWalletAddress: null,
        active: true,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.provider.create as jest.Mock).mockResolvedValue(mockCreated);

      const result = await service.create({
        name: 'New Provider',
        walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
      });

      expect(result.name).toBe('New Provider');
      expect(result.active).toBe(true);
      expect(mockPrisma.provider.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a provider', async () => {
      const mockUpdated = {
        id: 'p-1',
        name: 'Updated Name',
        walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
        payoutWalletAddress: null,
        active: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.provider.update as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.update('p-1', { name: 'Updated Name', active: false });

      expect(result.name).toBe('Updated Name');
      expect(result.active).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes a provider', async () => {
      (mockPrisma.provider.delete as jest.Mock).mockResolvedValue({});

      await expect(service.delete('p-1')).resolves.toBeUndefined();
      expect(mockPrisma.provider.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
    });
  });

  describe('findByWalletAddress', () => {
    it('finds provider by wallet address', async () => {
      const wallet = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F';
      const mockProvider = {
        id: 'p-1',
        name: 'Test',
        walletAddress: wallet,
        payoutWalletAddress: null,
        active: true,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.provider.findFirst as jest.Mock).mockResolvedValue(mockProvider);

      const result = await service.findByWalletAddress(wallet);

      expect(result?.walletAddress).toBe(wallet);
    });
  });
});
