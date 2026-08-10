import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RateLimitGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
