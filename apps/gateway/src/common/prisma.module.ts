import { Global, Module } from '@nestjs/common';
import { prisma } from '@x402/database';

@Global()
@Module({
  providers: [{ provide: 'PRISMA', useValue: prisma }],
  exports: ['PRISMA'],
})
export class PrismaModule {}
