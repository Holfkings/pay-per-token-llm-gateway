import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('test')
  @ApiOperation({ summary: 'Send a test webhook' })
  async test(@Body() body: { webhookUrl: string }) {
    if (!body?.webhookUrl) {
      throw new BadRequestException('webhookUrl is required');
    }
    try {
      const success = await this.webhooksService.sendWebhook(body.webhookUrl, {
        test: true,
        message: 'Hello from x402 Gateway!',
        timestamp: new Date().toISOString(),
      });

      return { success };
    } catch (error) {
      // SSRF/URL validation failures are client errors, not server errors.
      throw new BadRequestException((error as Error).message);
    }
  }
}
