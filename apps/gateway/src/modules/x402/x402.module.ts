import { Module } from '@nestjs/common';
import { X402Service } from './x402.service';
import { X402Controller } from './x402.controller';
import { RoutesModule } from '../routes/routes.module';
import { PaymentsModule } from '../payments/payments.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [RoutesModule, PaymentsModule, AnalyticsModule],
  controllers: [X402Controller],
  providers: [X402Service],
  exports: [X402Service],
})
export class X402Module {}
