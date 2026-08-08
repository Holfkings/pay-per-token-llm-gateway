import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  @ApiOperation({ summary: 'List all providers' })
  async findAll() {
    return this.providersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get provider by ID' })
  async findById(@Param('id') id: string) {
    return this.providersService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Register a new provider' })
  async create(
    @Body() body: { name: string; walletAddress: string; payoutWalletAddress?: string },
  ) {
    return this.providersService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update provider' })
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; walletAddress?: string; active?: boolean },
  ) {
    return this.providersService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete provider' })
  async delete(@Param('id') id: string) {
    await this.providersService.delete(id);
  }
}
