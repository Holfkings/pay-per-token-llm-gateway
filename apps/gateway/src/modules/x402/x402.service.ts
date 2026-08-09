import { Injectable, Inject } from '@nestjs/common';
import {
  generateQuote,
  verifyStellarPayment,
  generateReceipt,
  buildPaymentRequiredResponse,
  ReplayProtection,
  type RedisLike,
} from '@x402/x402-core';
import { getConfig } from '@x402/config';
import { logger } from '@x402/logger';
import { isPaymentUsedOnChain } from './contract-client';
import type { Quote, PaymentVerification, PaymentReceipt, RouteConfig } from '@x402/types';
import type { PrismaClient } from '@x402/database';

@Injectable()
export class X402Service {
  private readonly replayProtection: ReplayProtection;

  constructor(
    @Inject('PRISMA') private readonly prisma: PrismaClient,
    @Inject('REDIS') redisClient: RedisLike,
  ) {
    this.replayProtection = new ReplayProtection(redisClient);
  }

  /**
   * Generate a quote for a given route.
   */
  async generateQuoteForRoute(route: RouteConfig, estimatedTokens?: number): Promise<Quote> {
    const config = getConfig();

    // Look up the provider's wallet address from the database
    const provider = await this.prisma.provider.findUnique({
      where: { id: route.providerId },
    });
    const providerAddress = provider?.walletAddress || '';

    const quote = generateQuote({
      route,
      providerAddress,
      gatewayBaseUrl: `http://${config.host}:${config.port}`,
      network: config.stellar.network,
      quoteExpirySeconds: config.payment.quoteExpirySeconds,
      usdcIssuer: config.payment.usdcIssuer,
      estimatedTokens,
    });

    logger.info('Quote generated', { quoteId: quote.id, route: route.path, providerAddress });

    return quote;
  }

  /**
   * Build a 402 Payment Required response.
   */
  async build402Response(quote: Quote) {
    const config = getConfig();
    return buildPaymentRequiredResponse({
      quote,
      gatewayBaseUrl: `http://${config.host}:${config.port}`,
    });
  }

  /**
   * Verify a Stellar payment.
   *
   * Uses two layers of verification:
   * 1. Primary: Horizon API for on-chain payment validation
   * 2. Secondary: Soroban payment-verifier contract for immutable audit trail
   */
  async verifyPayment(txHash: string, quote: Quote): Promise<PaymentVerification> {
    const config = getConfig();

    // Layer 1: Redis-backed replay protection (fast, local)
    if (await this.replayProtection.isUsed(txHash)) {
      return {
        verified: false,
        txHash,
        payerAddress: '',
        amount: '0',
        asset: quote.asset,
        ledger: 0,
        timestamp: 0,
        failureReason: 'Payment already used (replay protection)',
      };
    }

    // Layer 1b: On-chain replay protection (immutable, cross-gateway)
    // This catches replays even if Redis data is lost
    const contractUsed = await isPaymentUsedOnChain(
      config.contracts.paymentVerifier,
      txHash,
      config.stellar.sorobanRpcUrl,
    );
    if (contractUsed) {
      // Mark in Redis too so we don't query the contract again
      await this.replayProtection.markUsed(txHash, config.redis.paymentCacheTtl);
      return {
        verified: false,
        txHash,
        payerAddress: '',
        amount: '0',
        asset: quote.asset,
        ledger: 0,
        timestamp: 0,
        failureReason: 'Payment already used (on-chain replay protection)',
      };
    }

    // Layer 2: On-chain verification via Horizon
    const verification = await verifyStellarPayment({
      txHash,
      quote,
      horizonUrl: config.stellar.horizonUrl,
      sorobanRpcUrl: config.stellar.sorobanRpcUrl,
      networkPassphrase: config.stellar.networkPassphrase,
      usedPayments: new Set(),
    });

    if (verification.verified) {
      await this.replayProtection.markUsed(txHash, config.redis.paymentCacheTtl);
    }

    return verification;
  }

  /**
   * Generate a payment receipt.
   */
  generateReceipt(verification: PaymentVerification, quote: Quote): PaymentReceipt {
    return generateReceipt(verification, quote);
  }

  /**
   * Validate that a quote hasn't expired.
   */
  isQuoteExpired(quote: Quote): boolean {
    return Date.now() / 1000 > quote.expiresAt;
  }
}
