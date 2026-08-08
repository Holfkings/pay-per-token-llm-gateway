import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('test')
  @ApiOperation({ summary: 'Send a test webhook' })
  async test(@Body() body: { webhookUrl: string }) {
    const success = await this.webhooksService.sendWebhook(body.webhookUrl, {
      test: true,
      message: 'Hello from x402 Gateway!',
      timestamp: new Date().toISOString(),
    });

    return { success };
  }
}
