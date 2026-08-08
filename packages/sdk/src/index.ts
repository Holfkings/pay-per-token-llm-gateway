// ──────────────────────────────────────────────
// @x402/sdk — Client SDK for the 402 → pay → retry flow
// ──────────────────────────────────────────────

import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  PaymentRequiredResponse,
  Quote,
  PaymentReceipt,
  X402ClientConfig,
  X402CallResult,
  X402StreamResult,
  PaymentAsset,
  StellarNetwork,
} from '@x402/types';
import { sleep } from '@x402/shared';
import { logger } from '@x402/logger';
import { buildPaymentTransaction, createHorizonServer } from '@x402/wallet';

// ── Default Configuration ────────────────────

const DEFAULT_CONFIG: Partial<X402ClientConfig> = {
  network: 'testnet',
  defaultAsset: 'USDC',
  paymentTimeout: 300_000, // 5 minutes
};

/**
 * x402 Client — automatically handles 402 → pay → retry.
 */
export class X402Client {
  private config: X402ClientConfig;

  constructor(config: X402ClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────

  /**
   * Make an LLM API call through the x402 gateway.
   * Automatically handles 402 responses by paying and retrying.
   */
  async call(
    request: ChatCompletionRequest,
    options?: {
      path?: string;
      asset?: PaymentAsset;
      headers?: Record<string, string>;
    },
  ): Promise<X402CallResult> {
    const route = options?.path || '/v1/chat/completions';
    const url = `${this.config.gatewayUrl}${route}`;

    logger.info('Making x402 call', { url, model: request.model });

    const firstResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(request),
    });

    // 402 → handle payment + retry
    if (firstResponse.status === 402) {
      const paymentRequired: PaymentRequiredResponse = await firstResponse.json();
      await firstResponse.body?.cancel();
      return this.handle402Payment(paymentRequired, request, route, options, false);
    }

    if (firstResponse.ok) {
      const response: ChatCompletionResponse = await firstResponse.json();
      return { success: true, response, cost: { amount: '0', asset: 'USDC' } };
    }

    const errorBody = await firstResponse.text();
    return { success: false, error: `Gateway error: ${firstResponse.status} ${errorBody}` };
  }

  /**
   * Make a streaming LLM API call through the x402 gateway.
   * Returns an async generator of SSE chunks.
   */
  async callStream(
    request: ChatCompletionRequest,
    options?: { path?: string; asset?: PaymentAsset; headers?: Record<string, string> },
  ): Promise<X402StreamResult> {
    const route = options?.path || '/v1/chat/completions';
    const streamingRequest = { ...request, stream: true };
    const url = `${this.config.gatewayUrl}${route}`;

    const firstResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(streamingRequest),
    });

    if (firstResponse.status === 402) {
      const paymentRequired: PaymentRequiredResponse = await firstResponse.json();
      await firstResponse.body?.cancel();
      return this.handle402Payment(paymentRequired, streamingRequest, route, options, true);
    }

    if (firstResponse.ok) {
      const receipt = this.parseReceiptHeader(firstResponse.headers.get('X-Payment-Receipt'));
      return {
        success: true,
        stream: this.sseGenerator(firstResponse),
        receipt,
        cost: receipt
          ? { amount: receipt.amount, asset: receipt.asset as PaymentAsset }
          : undefined,
      };
    }

    const errorBody = await firstResponse.text();
    return { success: false, error: `Gateway error: ${firstResponse.status} ${errorBody}` };
  }

  /** Check the payment status for a quote. */
  async checkPaymentStatus(quoteId: string): Promise<PaymentReceipt | null> {
    try {
      const response = await fetch(`${this.config.gatewayUrl}/api/v1/payments/${quoteId}/status`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  // ── Shared Payment Logic ────────────────────

  /**
   * Shared 402 → pay → retry flow used by both call() and callStream().
   */
  private async handle402Payment(
    paymentRequired: PaymentRequiredResponse,
    request: ChatCompletionRequest,
    route: string,
    options: { headers?: Record<string, string>; asset?: PaymentAsset } | undefined,
    isStream: boolean,
  ): Promise<X402CallResult | X402StreamResult> {
    const { quote } = paymentRequired;

    // Validate quote
    if (Date.now() / 1000 > quote.expiresAt) {
      return { success: false, error: 'Quote expired before payment could be made' };
    }

    const requiredAsset = options?.asset || this.config.defaultAsset || 'USDC';
    if (requiredAsset !== quote.asset) {
      return {
        success: false,
        error: `Wrong asset: gateway requires ${quote.asset}, you're paying with ${requiredAsset}`,
      };
    }

    // Execute payment
    const txHashResult = await this.executePayment(quote);
    if (!txHashResult.success) {
      return txHashResult;
    }

    // Retry the request with payment proof
    const url = `${this.config.gatewayUrl}${route}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Hash': txHashResult.txHash!,
        ...options?.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `Gateway error after payment: ${response.status} ${errorBody}`,
      };
    }

    if (isStream) {
      const receipt = this.parseReceiptHeader(response.headers.get('X-Payment-Receipt'));
      return {
        success: true,
        stream: this.sseGenerator(response),
        receipt,
        cost: receipt
          ? { amount: receipt.amount, asset: receipt.asset as PaymentAsset }
          : undefined,
      } as X402StreamResult;
    }

    const llmResponse: ChatCompletionResponse = await response.json();
    const receipt: PaymentReceipt | undefined = response.headers.get('X-Payment-Receipt')
      ? JSON.parse(response.headers.get('X-Payment-Receipt')!)
      : undefined;

    return {
      success: true,
      response: llmResponse,
      receipt,
      cost: receipt ? { amount: receipt.amount, asset: receipt.asset as PaymentAsset } : undefined,
    } as X402CallResult;
  }

  /**
   * Build, submit, and confirm a Stellar payment for the given quote.
   * Returns the txHash on success, or an error result on failure.
   */
  private async executePayment(
    quote: Quote,
  ): Promise<{ success: true; txHash: string } | { success: false; error: string }> {
    if (!this.config.secretKey) {
      if (this.config.signTransaction) {
        return {
          success: false,
          error: 'External wallet signing not yet implemented — provide a secretKey',
        };
      }
      return {
        success: false,
        error: `Payment required. Send ${quote.amount} ${quote.asset} to ${quote.paymentAddress}.`,
      };
    }

    try {
      const result = await buildPaymentTransaction({
        sourceSecret: this.config.secretKey,
        destination: quote.paymentAddress,
        amount: quote.amount,
        asset: quote.asset,
        assetIssuer: quote.assetIssuer,
        memo: quote.memo,
        network: quote.network,
        horizonUrl: this.getHorizonUrl(quote.network),
      });

      // Submit to Horizon via SDK server (not raw fetch)
      const server = createHorizonServer(quote.network);
      await server.submitTransaction(result.txXdr);

      logger.info('Payment submitted', {
        txHash: result.txHash,
        amount: quote.amount,
        asset: quote.asset,
      });

      const confirmed = await this.waitForConfirmation(result.txHash, quote);
      if (!confirmed) {
        return { success: false, error: 'Payment not confirmed within timeout' };
      }

      return { success: true, txHash: result.txHash };
    } catch (error) {
      return { success: false, error: `Payment failed: ${(error as Error).message}` };
    }
  }

  // ── Helpers ─────────────────────────────────

  private async waitForConfirmation(txHash: string, quote: Quote): Promise<boolean> {
    const deadline = Date.now() + (this.config.paymentTimeout || 300_000);
    const horizonUrl = this.getHorizonUrl(quote.network);

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${horizonUrl}/transactions/${txHash}`);
        if (response.ok) {
          const txData = await response.json();
          if (txData.successful) return true;
        }
      } catch {
        // Transaction not found yet — keep waiting
      }
      await sleep(2000);
    }

    return false;
  }

  private getHorizonUrl(network: StellarNetwork): string {
    switch (network) {
      case 'mainnet':
        return 'https://horizon.stellar.org';
      case 'futurenet':
        return 'https://horizon-futurenet.stellar.org';
      case 'testnet':
      default:
        return 'https://horizon-testnet.stellar.org';
    }
  }

  /** Parse SSE chunks from a fetch Response into an async generator. */
  private async *sseGenerator(
    response: globalThis.Response,
  ): AsyncGenerator<ChatCompletionStreamChunk, void, unknown> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const chunk: ChatCompletionStreamChunk = JSON.parse(data);
            yield chunk;
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseReceiptHeader(header: string | null): PaymentReceipt | undefined {
    if (!header) return undefined;
    try {
      return JSON.parse(header);
    } catch {
      return undefined;
    }
  }
}

/**
 * Create a new x402 client instance.
 */
export function createX402Client(config: X402ClientConfig): X402Client {
  return new X402Client(config);
}
