import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';

/** Coerce a query param to a positive integer, throwing 400 on garbage. */
function clampPositiveInt(value: unknown, fallback: number, max?: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new BadRequestException(`Invalid numeric query parameter: ${value}`);
  }
  return max ? Math.min(Math.floor(n), max) : Math.floor(n);
}
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentWallet } from '../auth/current-wallet.decorator';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get analytics summary for the authenticated wallet' })
  @ApiQuery({ name: 'providerId', required: false })
  async getSummary(@CurrentWallet() wallet: string, @Query('providerId') providerId?: string) {
    return this.analyticsService.getSummary(wallet, providerId);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Get time-series analytics data' })
  @ApiQuery({ name: 'providerId', required: true })
  @ApiQuery({ name: 'intervalMinutes', required: false })
  @ApiQuery({ name: 'durationHours', required: false })
  async getTimeSeries(
    @CurrentWallet() wallet: string,
    @Query('providerId') providerId: string,
    @Query('intervalMinutes') intervalMinutes?: number,
    @Query('durationHours') durationHours?: number,
  ) {
    // Validate/clamp query params — intervalMinutes=0 previously caused an
    // infinite loop (NaN/zero bucket size) and negative values were undefined.
    const interval = clampPositiveInt(intervalMinutes, 60);
    const duration = clampPositiveInt(durationHours, 24, 168);
    return this.analyticsService.getTimeSeries(providerId, wallet, interval, duration);
  }

  @Get('events')
  @ApiOperation({ summary: 'Get raw analytics events' })
  @ApiQuery({ name: 'providerId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEvents(
    @CurrentWallet() wallet: string,
    @Query('providerId') providerId?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
  ) {
    // Clamp limit — negative/garbage values would otherwise reach Prisma.
    const safeLimit = clampPositiveInt(limit, 100, 1000);
    return this.analyticsService.getEvents(wallet, {
      providerId,
      type,
      limit: safeLimit,
    });
  }
}
