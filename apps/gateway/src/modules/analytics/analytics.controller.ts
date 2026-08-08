import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get analytics summary' })
  @ApiQuery({ name: 'providerId', required: false })
  async getSummary(@Query('providerId') providerId?: string) {
    return this.analyticsService.getSummary(providerId);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Get time-series analytics data' })
  @ApiQuery({ name: 'providerId', required: true })
  @ApiQuery({ name: 'intervalMinutes', required: false })
  @ApiQuery({ name: 'durationHours', required: false })
  async getTimeSeries(
    @Query('providerId') providerId: string,
    @Query('intervalMinutes') intervalMinutes?: number,
    @Query('durationHours') durationHours?: number,
  ) {
    return this.analyticsService.getTimeSeries(
      providerId,
      intervalMinutes ? Number(intervalMinutes) : undefined,
      durationHours ? Number(durationHours) : undefined,
    );
  }

  @Get('events')
  @ApiOperation({ summary: 'Get raw analytics events' })
  @ApiQuery({ name: 'providerId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEvents(
    @Query('providerId') providerId?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
  ) {
    return this.analyticsService.getEvents({
      providerId,
      type,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
