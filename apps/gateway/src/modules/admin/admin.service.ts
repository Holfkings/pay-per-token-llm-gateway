import { Injectable } from '@nestjs/common';
import { prisma } from '@x402/database';
import { logger } from '@x402/logger';

@Injectable()
export class AdminService {
  async getHealth() {
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '0.1.0',
    };
  }

  async getStats() {
    const [providers, routes, payments, confirmedPayments] = await Promise.all([
      prisma.provider.count(),
      prisma.route.count(),
      prisma.payment.count(),
      prisma.payment.count({ where: { status: 'confirmed' } }),
    ]);

    return {
      providers,
      routes,
      totalPayments: payments,
      confirmedPayments,
      failedPayments: payments - confirmedPayments,
    };
  }

  async getAuditLogs(
    options: {
      page?: number;
      limit?: number;
      action?: string;
      entity?: string;
    } = {},
  ): Promise<{
    data: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const { action, entity } = options;
    const where: any = {};
    if (action) where.action = action;
    if (entity) where.entity = entity;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data: logs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async writeAuditLog(data: {
    action: string;
    entity: string;
    entityId?: string;
    actor?: string;
    details?: Record<string, unknown>;
    ip?: string;
  }) {
    await prisma.auditLog.create({ data: data as any });
  }
}
