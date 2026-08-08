import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import type { PaymentAsset } from '@x402/types';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  @ApiOperation({ summary: 'List all routes' })
  @ApiQuery({ name: 'providerId', required: false })
  async findAll(@Query('providerId') providerId?: string) {
    return this.routesService.findAll(providerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get route by ID' })
  async findById(@Param('id') id: string) {
    return this.routesService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new protected route' })
  async create(
    @Body()
    body: {
      providerId: string;
      path: string;
      upstreamUrl: string;
      model: string;
      pricingModel: 'flat' | 'per_token';
      flatPrice?: string;
      perTokenPrice?: string;
      acceptedAssets?: PaymentAsset[];
      rateLimit?: number;
    },
  ) {
    return this.routesService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a route' })
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      upstreamUrl?: string;
      flatPrice?: string;
      perTokenPrice?: string;
      pricingModel?: 'flat' | 'per_token';
      rateLimit?: number;
      active?: boolean;
    },
  ) {
    return this.routesService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a route' })
  async delete(@Param('id') id: string) {
    await this.routesService.delete(id);
  }
}
