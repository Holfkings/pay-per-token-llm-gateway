import { Module } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RoutesController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
