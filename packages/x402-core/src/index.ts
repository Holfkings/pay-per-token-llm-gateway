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
}

/**
 * Generate a payment quote for a given route configuration.
 */
export function generateQuote(options: QuoteGeneratorOptions): Quote {
  const expiresAt = nowUnix() + options.quoteExpirySeconds;
  const quoteId = generateId();
  const price =
    options.route.pricingModel === 'flat' ? options.route.flatPrice : options.route.perTokenPrice;
  const asset: PaymentAsset = options.route.acceptedAssets[0] || 'USDC';

  return {
    id: quoteId,
    route: options.route.path,
    pricingModel: options.route.pricingModel,
    amount: price || '0',
    asset,
    assetIssuer: asset === 'USDC' ? options.usdcIssuer : undefined,
    paymentAddress: options.providerAddress,
    network: options.network,
    expiresAt,
    statusUrl: `${options.gatewayBaseUrl}/api/v1/payments/${quoteId}/status`,
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

  const instructions = [
    `Payment of ${quote.amount} ${quote.asset} is required to access ${quote.route}.`,
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
 * This is a reference implementation that queries Horizon for the transaction
 * and validates:
 * 1. The transaction exists and was successful
 * 2. The destination matches the expected payment address
 * 3. The amount and asset match the quote
 * 4. The payment hasn't been used before (replay protection)
 * 5. The payment was made within the quote expiry window
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

    // Find a payment that matches our destination and amount
    const matchingPayment = paymentOps.find((op: any) => {
      const assetMatches =
        quote.asset === 'XLM'
          ? op.asset_type === 'native'
          : op.asset_code === quote.asset && op.asset_issuer === quote.assetIssuer;

      return op.to === quote.paymentAddress && assetMatches && op.amount === quote.amount;
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
    logger.info('Payment verified successfully', { txHash, quoteId: quote.id });

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
    logger.error('Payment verification error', { txHash, error: String(error) });
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
 * In-memory replay protection cache.
 * In production, this should be backed by Redis.
 */
export class ReplayProtection {
  private usedPayments = new Set<string>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Check if a payment hash has been used.
   */
  isUsed(txHash: TxHash): boolean {
    return this.usedPayments.has(txHash);
  }

  /**
   * Mark a payment hash as used with a TTL.
   */
  markUsed(txHash: TxHash, ttlSeconds = 3600): void {
    this.usedPayments.add(txHash);

    // Auto-cleanup after TTL
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
   * Get current size
   */
  get size(): number {
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
 */
export function calculatePrice(options: PriceCalculationOptions): {
  amount: string;
  asset: PaymentAsset;
} {
  const { route, tokenCount } = options;

  if (route.pricingModel === 'flat' && route.flatPrice) {
    return { amount: route.flatPrice, asset: route.acceptedAssets[0] };
  }

  if (route.pricingModel === 'per_token' && route.perTokenPrice && tokenCount) {
    const total = (BigInt(route.perTokenPrice) * BigInt(tokenCount)).toString();
    return { amount: total, asset: route.acceptedAssets[0] };
  }

  logger.warn('Could not calculate price', { route: route.path, pricingModel: route.pricingModel });
  return { amount: '0', asset: route.acceptedAssets[0] || 'USDC' };
}
