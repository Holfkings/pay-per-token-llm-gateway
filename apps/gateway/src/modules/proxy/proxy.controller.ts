import {
  Controller,
  All,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProxyService } from './proxy.service';
import { X402Service } from '../x402/x402.service';
import { RoutesService } from '../routes/routes.service';
import { PaymentsService } from '../payments/payments.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AdminService } from '../admin/admin.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { chatCompletionRequestSchema } from '@x402/validation';
import { logger } from '@x402/logger';
import { generateId } from '@x402/shared';
import type { ChatCompletionRequest, PaymentRecord, RouteConfig } from '@x402/types';

@ApiTags('proxy')
@Controller()
@UseGuards(RateLimitGuard)
export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly x402Service: X402Service,
    private readonly routesService: RoutesService,
    private readonly paymentsService: PaymentsService,
    private readonly analyticsService: AnalyticsService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * Main proxy endpoint — catches all LLM API requests.
   *
   * Flow:
   * 1. Validate the request body
   * 2. Look up the route for the requested model + path
   * 3. If no payment header: generate quote, store pending payment, return 402
   * 4. If payment: verify on-chain, then:
   *    - stream=true → pipe SSE stream from upstream to client
   *    - stream=false → forward, collect full response, return JSON
   */
  @All('chat/completions')
  @HttpCode(HttpStatus.OK)
  async handleChatCompletion(@Req() req: Request, @Res() res: Response) {
    const traceId = generateId();
    const startTime = Date.now();

    try {
      // 1. Validate request
      const parseResult = chatCompletionRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new BadRequestException({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid chat completion request',
          details: parseResult.error.flatten(),
        });
      }
      const body = parseResult.data;
      const model = body.model;

      // 2. Look up route — use the actual request path, not hardcoded
      const route = await this.routesService.findByPathAndModel(req.path, model);
      if (!route) {
        return res.status(404).json({
          status: 404,
          error: 'Not Found',
          message: `No route configured for model: ${model}`,
        });
      }

      // 3. Check for payment header
      const txHash = req.headers['x-payment-hash'] as string | undefined;
      if (!txHash) {
        return this.handle402Response(res, route, traceId, model);
      }

      // 4. Verify payment (includes cross-route replay protection)
      const verified = await this.verifyAndConfirmPayment(txHash, route, res, traceId);
      if (!verified) {
        return; // 402 error response already sent
      }

      // 5. Resolve upstream API key
      const upstreamApiKey =
        process.env[`UPSTREAM_API_KEY_${route.providerId.toUpperCase().replace(/-/g, '_')}`];
      const payment = await this.paymentsService.findByTxHash(txHash);

      if (body.stream) {
        // ── Streaming path ──
        return this.handleStreamingForward(
          req,
          res,
          body,
          route,
          txHash,
          upstreamApiKey,
          payment,
          traceId,
          startTime,
        );
      }

      // ── Non-streaming path ──
      return this.handleNonStreamingForward(
        res,
        body,
        route,
        txHash,
        upstreamApiKey,
        payment,
        traceId,
        startTime,
      );
    } catch (error) {
      logger.error('Proxy error', { traceId, error: String(error) });

      if (error instanceof BadRequestException) {
        return res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: error.message,
        });
      }

      return res.status(502).json({
        status: 502,
        error: 'Bad Gateway',
        message: 'Upstream LLM request failed',
      });
    }
  }

  // ── Helper methods ───────────────────────────

  /**
   * Send a 402 Payment Required response and record the pending payment.
   */
  private async handle402Response(
    res: Response,
    route: RouteConfig,
    traceId: string,
    model: string,
  ) {
    logger.info('402: Payment required', { traceId, model });

    const quote = await this.x402Service.generateQuoteForRoute(route);
    const payment402 = await this.x402Service.build402Response(quote);

    await this.paymentsService.createPendingPayment(quote, route);
    this.analyticsService.recordUnpaidRequest(route.path, route.providerId);

    await this.adminService.writeAuditLog({
      action: 'quote_generated',
      entity: 'quote',
      entityId: quote.id,
      actor: 'system',
      details: { model, route: route.path, amount: quote.amount, traceId },
    });

    return res.status(402).json(payment402);
  }

  /**
   * Verify payment on-chain and confirm it. Returns true if verified.
   * Sends a 402 error response directly if verification fails.
   */
  private async verifyAndConfirmPayment(
    txHash: string,
    route: RouteConfig,
    res: Response,
    traceId: string,
  ): Promise<boolean> {
    logger.info('Verifying payment', { traceId, txHash });

    const existingPayment = await this.paymentsService.findByTxHash(txHash);

    // Cross-route replay protection: a confirmed payment for model A
    // should not grant access to model B
    if (existingPayment?.status === 'confirmed') {
      if (existingPayment.routeId !== route.id) {
        logger.warn('Cross-route replay attempt', {
          traceId,
          txHash,
          existingRoute: existingPayment.routeId,
          requestedRoute: route.id,
        });
        res.status(402).json({
          status: 402,
          error: 'Payment Required',
          message: 'This payment was made for a different route. A new payment is required.',
        });
        return false;
      }

      logger.info('Payment already confirmed for this route', { traceId, txHash });
      return true;
    }

    const quote = await this.x402Service.generateQuoteForRoute(route);
    const quoteForVerification = existingPayment?.receiptJson
      ? (existingPayment.receiptJson as any)
      : quote;

    const verification = await this.x402Service.verifyPayment(txHash, quoteForVerification);

    if (!verification.verified) {
      logger.warn('Payment verification failed', {
        traceId,
        txHash,
        reason: verification.failureReason,
      });

      await this.adminService.writeAuditLog({
        action: 'payment_verification_failed',
        entity: 'payment',
        entityId: txHash,
        actor: verification.payerAddress,
        details: { reason: verification.failureReason, route: route.path, traceId },
      });

      res.status(402).json({
        status: 402,
        error: 'Payment Required',
        message: `Payment verification failed: ${verification.failureReason}`,
      });
      return false;
    }

    if (existingPayment) {
      await this.paymentsService.confirmPayment(existingPayment.quoteId, verification);
    } else {
      await this.paymentsService.createPendingPayment(quote, route);
      await this.paymentsService.confirmPayment(quote.id, verification);
    }

    await this.adminService.writeAuditLog({
      action: 'payment_verified',
      entity: 'payment',
      entityId: txHash,
      actor: verification.payerAddress,
      details: {
        amount: verification.amount,
        asset: verification.asset,
        route: route.path,
        traceId,
      },
    });

    return true;
  }

  /**
   * Forward a streaming request: pipe SSE chunks from upstream to client.
   * Records stream duration for analytics.
   */
  private async handleStreamingForward(
    req: Request,
    res: Response,
    body: ChatCompletionRequest,
    route: RouteConfig,
    txHash: string,
    apiKey: string | undefined,
    payment: PaymentRecord | null,
    traceId: string,
    startTime: number,
  ) {
    logger.info('Forwarding streaming request to upstream', {
      traceId,
      model: body.model,
      upstreamUrl: route.upstreamUrl,
    });

    // Set trace ID header before streaming starts
    res.setHeader('X-Request-Trace-Id', traceId);

    // Add x402 receipt header if payment exists
    if (payment) {
      res.setHeader(
        'X-Payment-Receipt',
        JSON.stringify({
          id: payment.id,
          quoteId: payment.quoteId,
          txHash: payment.txHash,
          payerAddress: payment.payerAddress,
          amount: payment.amount?.toString(),
          asset: payment.asset,
          status: payment.status,
        }),
      );
    }

    // Pipe upstream SSE stream to client
    await this.proxyService.forwardStreamRequest(
      body,
      route.upstreamUrl,
      res,
      apiKey,
      traceId,
      (totalTokens) => {
        // Analytics recorded asynchronously after stream completes
        const streamDuration = Date.now() - startTime;
        this.analyticsService.recordPaidRequest(
          route.path,
          route.providerId,
          payment?.payerAddress || 'unknown',
          payment?.amount?.toString() || '0',
          payment?.asset || 'USDC',
          streamDuration,
        );
      },
    );

    await this.adminService.writeAuditLog({
      action: 'request_forwarded_stream',
      entity: 'request',
      entityId: traceId,
      actor: payment?.payerAddress || 'unknown',
      details: { model: body.model, route: route.path, txHash, traceId },
    });
  }

  /**
   * Forward a non-streaming request: collect full response and return as JSON.
   */
  private async handleNonStreamingForward(
    res: Response,
    body: ChatCompletionRequest,
    route: RouteConfig,
    txHash: string,
    apiKey: string | undefined,
    payment: PaymentRecord | null,
    traceId: string,
    startTime: number,
  ) {
    logger.info('Forwarding request to upstream', {
      traceId,
      model: body.model,
      upstreamUrl: route.upstreamUrl,
    });

    const { response, responseTime } = await this.proxyService.forwardRequest(
      body,
      route.upstreamUrl,
      apiKey,
      traceId,
    );

    // Record analytics with actual response time
    this.analyticsService.recordPaidRequest(
      route.path,
      route.providerId,
      payment?.payerAddress || 'unknown',
      payment?.amount?.toString() || '0',
      payment?.asset || 'USDC',
      responseTime,
    );

    // Add x402 headers
    if (payment) {
      res.setHeader(
        'X-Payment-Receipt',
        JSON.stringify({
          id: payment.id,
          quoteId: payment.quoteId,
          txHash: payment.txHash,
          payerAddress: payment.payerAddress,
          amount: payment.amount?.toString(),
          asset: payment.asset,
          status: payment.status,
        }),
      );
    }
    res.setHeader('X-Request-Trace-Id', traceId);

    await this.adminService.writeAuditLog({
      action: 'request_forwarded',
      entity: 'request',
      entityId: traceId,
      actor: payment?.payerAddress || 'unknown',
      details: {
        model: body.model,
        route: route.path,
        txHash,
        responseTime,
        tokens: response.usage?.total_tokens,
        traceId,
      },
    });

    return res.json(response);
  }
}
