import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { getConfig } from '@x402/config';
import { logger } from '@x402/logger';

async function bootstrap() {
  const config = getConfig();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // we set it explicitly below with a size limit
  });

  // Body size limit: 1 MB is enough for any reasonable chat completion request
  app.use(json({ limit: '1mb' }));

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  app.enableCors({
    origin: config.security.corsOrigins,
    credentials: true,
  });

  // Global exception filter (consistent error format + Retry-After for 429)
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('x402 LLM Gateway')
    .setDescription(
      'Pay-per-request LLM gateway using x402 stablecoin micropayments on Stellar.\n\n' +
        'No API keys — just pay in USDC on Stellar and get access to any LLM endpoint.',
    )
    .setVersion('0.1.0')
    .addTag('x402', 'x402 payment protocol endpoints')
    .addTag('proxy', 'LLM proxy endpoints')
    .addTag('providers', 'Provider management')
    .addTag('payments', 'Payment history and status')
    .addTag('analytics', 'Usage and revenue analytics')
    .addTag('admin', 'Admin operations')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.port, config.host);
  logger.info(`🚀 x402 Gateway running on http://${config.host}:${config.port}`, {
    network: config.stellar.network,
    docs: `http://${config.host}:${config.port}/api/docs`,
  });
}

bootstrap();
