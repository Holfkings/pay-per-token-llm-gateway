// ──────────────────────────────────────────────
// @x402/x402-core — x402 Protocol Implementation
// ──────────────────────────────────────────────

import {
  Quote,
  PaymentVerification,
  PaymentReceipt,
  PaymentRequiredResponse,
  RouteConfig,
  PaymentAsset,
  StellarNetwork,
  StellarAddress,
  TxHash,
} from '@x402/types';
import { generateId, nowUnix } from '@x402/shared';
import { logger } from '@x402/logger';

// ── Quote Generation ─────────────────────────

export interface QuoteGeneratorOptions {
  route: RouteConfig;
  providerAddress: StellarAddress;
  gatewayBaseUrl: string;
  network: StellarNetwork;
  quoteExpirySeconds: number;
  usdcIssuer: string;
  /** Estimated max tokens for per-token pricing (from request max_tokens) */
  estimatedTokens?: number;
}

/** Default token estimate when max_tokens is not specified */
const DEFAULT_TOKEN_ESTIMATE = 4096;

/**
 * Generate a payment quote for a given route configuration.
 *
 * For flat pricing: amount = flatPrice (exact charge per request).
 * For per-token pricing: amount = perTokenPrice × estimatedTokens (deposit).
 *   The actual cost is calculated after the LLM response based on usage.total_tokens.
 */
export function generateQuote(options: QuoteGeneratorOptions): Quote {
  const expiresAt = nowUnix() + options.quoteExpirySeconds;
  const quoteId = generateId();
  const asset: PaymentAsset = options.route.acceptedAssets[0] || 'USDC';

  let amount: string;
  let estimatedMaxTokens: number | undefined;
  let perTokenPrice: string | undefined;

  if (options.route.pricingModel === 'per_token' && options.route.perTokenPrice) {
    // Per-token: charge estimated deposit
    perTokenPrice = options.route.perTokenPrice;
    estimatedMaxTokens = options.estimatedTokens || DEFAULT_TOKEN_ESTIMATE;
    amount = (BigInt(options.route.perTokenPrice) * BigInt(estimatedMaxTokens)).toString();
  } else {
    // Flat: charge flat price
    amount = options.route.flatPrice || '0';
  }

  return {
    id: quoteId,
    route: options.route.path,
    pricingModel: options.route.pricingModel,
    amount,
    asset,
    assetIssuer: asset === 'USDC' ? options.usdcIssuer : undefined,
    paymentAddress: options.providerAddress,
    network: options.network,
    expiresAt,
    statusUrl: `${options.gatewayBaseUrl}/api/v1/payments/${quoteId}/status`,
    estimatedMaxTokens,
    perTokenPrice,
  };
}

// ── 402 Response Builder ─────────────────────

export interface PaymentRequiredBuilderOptions {
  quote: Quote;
  gatewayBaseUrl: string;
}

/**
 * Build a standard HTTP 402 Payment Required response.
 */
export function buildPaymentRequiredResponse(
  options: PaymentRequiredBuilderOptions,
): PaymentRequiredResponse {
  const { quote, gatewayBaseUrl } = options;

  const pricingNote =
    quote.pricingModel === 'per_token'
      ? `\n(Pricing: ${quote.perTokenPrice} stroops per token, estimated for ${quote.estimatedMaxTokens} tokens)`
      : '';

  const instructions = [
    `Payment of ${quote.amount} ${quote.asset} is required to access ${quote.route}.${pricingNote}`,
    '',
    'To pay:',
    `1. Send ${quote.amount} ${quote.asset} to ${quote.paymentAddress}`,
    ...(quote.memo ? [`   Memo: ${quote.memo}`] : []),
    `2. Note the transaction hash`,
    `3. Retry your request with the header: X-Payment-Hash: <tx_hash>`,
    `4. Or check payment status at: ${quote.statusUrl}`,
    '',
    `This quote expires at: ${new Date(quote.expiresAt * 1000).toISOString()}`,
  ].join('\n');

  return {
    status: 402,
    message: 'Payment Required',
    quote,
    instructions,
    docs: `${gatewayBaseUrl}/docs/x402`,
  };
}

// ── Payment Verification ─────────────────────

export interface VerifyPaymentOptions {
  txHash: TxHash;
  quote: Quote;
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  /** Previously used payment hashes to prevent replay */
  usedPayments: Set<string>;
}

/**
 * Verify a Stellar payment on-chain.
 *
 * For flat pricing: exact amount match required.
 * For per-token pricing: payment amount must be >= perTokenPrice (minimum deposit),
 *   not an exact match (actual cost is calculated after response).
 */
export async function verifyStellarPayment(
  options: VerifyPaymentOptions,
): Promise<PaymentVerification> {
  const { txHash, quote, horizonUrl, usedPayments } = options;

  logger.info('Verifying payment', { txHash, quoteId: quote.id });

  // Replay protection: check if this tx has been used
  if (usedPayments.has(txHash)) {
    logger.warn('Replay attempt detected', { txHash });
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

  try {
    // Fetch transaction from Horizon
    const response = await fetch(`${horizonUrl}/transactions/${txHash}`);
    if (!response.ok) {
      if (response.status === 404) {
        return {
          verified: false,
          txHash,
          payerAddress: '',
          amount: '0',
          asset: quote.asset,
          ledger: 0,
          timestamp: 0,
          failureReason: 'Transaction not found on chain',
        };
      }
      throw new Error(`Horizon error: ${response.status} ${response.statusText}`);
    }

    const txData = (await response.json()) as Record<string, any>;

    // Check transaction succeeded
    if (!txData.successful) {
      return {
        verified: false,
        txHash,
        payerAddress: txData.source_account || '',
        amount: '0',
        asset: quote.asset,
        ledger: txData.ledger || 0,
        timestamp: Date.parse(txData.created_at) / 1000 || 0,
        failureReason: 'Transaction failed on chain',
      };
    }

    // Fetch payment operations
    const opsResponse = await fetch(`${horizonUrl}/transactions/${txHash}/operations`);
    if (!opsResponse.ok) {
      throw new Error(`Horizon operations error: ${opsResponse.status}`);
    }

    const opsData = (await opsResponse.json()) as Record<string, any>;
    const paymentOps =
      (opsData._embedded?.records as any[])?.filter(
        (op: any) =>
          op.type === 'payment' ||
          op.type === 'path_payment_strict_send' ||
          op.type === 'path_payment_strict_receive',
      ) || [];

    // Find a matching payment
    const matchingPayment = paymentOps.find((op: any) => {
      const assetMatches =
        quote.asset === 'XLM'
          ? op.asset_type === 'native'
          : op.asset_code === quote.asset && op.asset_issuer === quote.assetIssuer;

      if (!assetMatches || op.to !== quote.paymentAddress) return false;

      if (quote.pricingModel === 'per_token') {
        // Per-token: payment must be >= perTokenPrice (minimum 1 token deposit)
        const minimumAmount =
          quote.perTokenPrice && BigInt(quote.perTokenPrice) > 0n ? quote.perTokenPrice : '1';
        try {
          return BigInt(op.amount) >= BigInt(minimumAmount);
        } catch {
          return false;
        }
      }

      // Flat: exact amount match
      return op.amount === quote.amount;
    });

    if (!matchingPayment) {
      return {
        verified: false,
        txHash,
        payerAddress: txData.source_account || '',
        amount: '0',
        asset: quote.asset,
        ledger: txData.ledger || 0,
        timestamp: Date.parse(txData.created_at) / 1000 || 0,
        failureReason: 'No matching payment operation found',
      };
    }

    // Verify quote hasn't expired
    const txTime = Date.parse(txData.created_at) / 1000;
    if (txTime > quote.expiresAt) {
      return {
        verified: false,
        txHash,
        payerAddress: matchingPayment.from || txData.source_account,
        amount: matchingPayment.amount,
        asset: quote.asset,
        ledger: txData.ledger || 0,
        timestamp: txTime,
        failureReason: 'Payment was made after quote expired',
      };
    }

    // Payment verified!
    logger.info('Payment verified successfully', {
      txHash,
      quoteId: quote.id,
    });

    return {
      verified: true,
      txHash,
      payerAddress: matchingPayment.from || txData.source_account,
      amount: matchingPayment.amount,
      asset: quote.asset,
      ledger: txData.ledger || 0,
      timestamp: txTime,
    };
  } catch (error) {
    logger.error('Payment verification error', {
      txHash,
      error: String(error),
    });
    return {
      verified: false,
      txHash,
      payerAddress: '',
      amount: '0',
      asset: quote.asset,
      ledger: 0,
      timestamp: 0,
      failureReason: `Verification error: ${(error as Error).message}`,
    };
  }
}

// ── Receipt Generation ───────────────────────

export function generateReceipt(verification: PaymentVerification, quote: Quote): PaymentReceipt {
  return {
    id: generateId(),
    quoteId: quote.id,
    txHash: verification.txHash,
    payerAddress: verification.payerAddress,
    amount: verification.amount,
    asset: verification.asset,
    route: quote.route,
    status: 'confirmed',
    verifiedAt: new Date(verification.timestamp * 1000).toISOString(),
    ledger: verification.ledger,
  };
}

// ── Replay Protection ────────────────────────

/**
 * Minimal interface for Redis operations needed by ReplayProtection.
 * ioredis satisfies this interface natively.
 */
export interface RedisLike {
  exists(key: string): Promise<number>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
}

/**
 * Replay protection backed by Redis (when available) with in-memory fallback.
 *
 * When a Redis client is provided via constructor, all operations are
 * persisted to Redis with proper TTLs. This survives server restarts
 * and works correctly in multi-instance deployments.
 *
 * When no Redis client is provided, falls back to an in-memory Set
 * (useful for development and testing).
 */
export class ReplayProtection {
  private readonly redis: RedisLike | null;
  private readonly usedPayments = new Set<string>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  private static readonly KEY_PREFIX = 'x402:replay:';

  constructor(redis?: RedisLike) {
    this.redis = redis ?? null;
  }

  /** Check whether a transaction hash has already been used. */
  async isUsed(txHash: TxHash): Promise<boolean> {
    if (this.redis) {
      const exists = await this.redis.exists(ReplayProtection.KEY_PREFIX + txHash);
      return exists === 1;
    }
    return this.usedPayments.has(txHash);
  }

  /** Mark a transaction hash as used with a TTL. */
  async markUsed(txHash: TxHash, ttlSeconds = 3600): Promise<void> {
    if (this.redis) {
      await this.redis.set(ReplayProtection.KEY_PREFIX + txHash, '1', 'EX', String(ttlSeconds));
      return;
    }

    this.usedPayments.add(txHash);

    const existing = this.expiryTimers.get(txHash);
    if (existing) clearTimeout(existing);

    this.expiryTimers.set(
      txHash,
      setTimeout(() => {
        this.usedPayments.delete(txHash);
        this.expiryTimers.delete(txHash);
      }, ttlSeconds * 1000),
    );
  }

  /**
   * Number of tracked entries. Only accurate in in-memory mode;
   * throws when Redis is active (use Redis directly for metrics).
   */
  get size(): number {
    if (this.redis) {
      throw new Error('size is not available when Redis is in use');
    }
    return this.usedPayments.size;
  }
}

// ── Price Calculation ────────────────────────

export interface PriceCalculationOptions {
  route: RouteConfig;
  /** For per-token pricing: the number of tokens used */
  tokenCount?: number;
}

/**
 * Calculate the price for a request based on route pricing config.
 * For flat pricing: returns the flat price.
 * For per-token pricing: returns perTokenPrice × tokenCount.
 */
export function calculatePrice(options: PriceCalculationOptions): {
  amount: string;
  asset: PaymentAsset;
  /** For per-token: how much was overpaid or underpaid (negative = underpaid) */
  surplus?: string;
} {
  const { route, tokenCount } = options;
  const asset = route.acceptedAssets[0] || 'USDC';

  if (route.pricingModel === 'flat' && route.flatPrice) {
    return { amount: route.flatPrice, asset };
  }

  if (route.pricingModel === 'per_token' && route.perTokenPrice && tokenCount) {
    const total = (BigInt(route.perTokenPrice) * BigInt(tokenCount)).toString();
    return { amount: total, asset };
  }

  logger.warn('Could not calculate price', {
    route: route.path,
    pricingModel: route.pricingModel,
  });
  return { amount: '0', asset };
}

/**
 * Compare the paid amount against the actual cost.
 * Returns a surplus (positive = overpaid, zero = exact, negative = underpaid).
 */
export function comparePayment(
  paidAmount: string,
  actualCost: string,
): { surplus: string; isOverpaid: boolean; isUnderpaid: boolean } {
  const paid = BigInt(paidAmount);
  const cost = BigInt(actualCost);
  const surplusBig = paid - cost;

  // Underpaid: paid less than actual cost. Cap at 0 to avoid negative cost in response.
  if (surplusBig < 0n) {
    return {
      surplus: surplusBig.toString(),
      isOverpaid: false,
      isUnderpaid: true,
    };
  }

  return {
    surplus: surplusBig.toString(),
    isOverpaid: surplusBig > 0n,
    isUnderpaid: false,
  };
}
