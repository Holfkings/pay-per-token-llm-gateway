import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@x402/database';
import { logger } from '@x402/logger';
import type { Provider } from '@x402/types';

/**
 * Map a raw Prisma provider row to the typed Provider response.
 */
function toProviderResponse(p: {
  id: string;
  name: string;
  walletAddress: string;
  payoutWalletAddress: string | null;
  active: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Provider {
  return {
    id: p.id,
    name: p.name,
    walletAddress: p.walletAddress,
    payoutWalletAddress: p.payoutWalletAddress || undefined,
    active: p.active,
    metadata: p.metadata as Record<string, string> | undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProvidersService {
  async findAll(): Promise<Provider[]> {
    const providers = await prisma.provider.findMany({
      include: { routes: true },
    });

    return providers.map(toProviderResponse);
  }

  async findById(id: string): Promise<Provider> {
    const p = await prisma.provider.findUnique({
      where: { id },
      include: { routes: true },
    });

    if (!p) throw new NotFoundException(`Provider ${id} not found`);

    return toProviderResponse(p);
  }

  async create(data: {
    name: string;
    walletAddress: string;
    payoutWalletAddress?: string;
    metadata?: Record<string, string>;
  }): Promise<Provider> {
    const p = await prisma.provider.create({
      data: {
        name: data.name,
        walletAddress: data.walletAddress,
        payoutWalletAddress: data.payoutWalletAddress,
        metadata: data.metadata || {},
      },
    });

    logger.info('Provider created', { providerId: p.id, name: p.name });

    return toProviderResponse(p);
  }

  async update(
    id: string,
    data: Partial<Pick<Provider, 'name' | 'walletAddress' | 'active'>>,
  ): Promise<Provider> {
    const p = await prisma.provider.update({ where: { id }, data });
    return toProviderResponse(p);
  }

  async delete(id: string): Promise<void> {
    await prisma.provider.delete({ where: { id } });
    logger.info('Provider deleted', { providerId: id });
  }

  async findByWalletAddress(address: string): Promise<Provider | null> {
    const p = await prisma.provider.findFirst({ where: { walletAddress: address } });
    if (!p) return null;
    return toProviderResponse(p);
  }
}
