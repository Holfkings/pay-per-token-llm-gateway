import {
  generateQuote,
  buildPaymentRequiredResponse,
  calculatePrice,
  ReplayProtection,
} from './index';

import type { RouteConfig, PaymentAsset, StellarNetwork } from '@x402/types';

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    id: 'route-1',
    providerId: 'provider-1',
    path: '/v1/chat/completions',
    upstreamUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4',
    pricingModel: 'flat',
    flatPrice: '1000000',
    perTokenPrice: undefined,
    acceptedAssets: ['USDC'],
    rateLimit: 10,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateQuote', () => {
  it('generates a valid quote for a flat-rate route', () => {
    const route = makeRoute();
    const quote = generateQuote({
      route,
      providerAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
      gatewayBaseUrl: 'http://localhost:3000',
      network: 'testnet',
      quoteExpirySeconds: 300,
      usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });

    expect(quote.id).toBeDefined();
    expect(quote.route).toBe('/v1/chat/completions');
    expect(quote.pricingModel).toBe('flat');
    expect(quote.amount).toBe('1000000');
    expect(quote.asset).toBe('USDC');
    expect(quote.assetIssuer).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    expect(quote.paymentAddress).toBe('GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F');
    expect(quote.network).toBe('testnet');
    expect(quote.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(quote.statusUrl).toContain('/api/v1/payments/');
  });

  it('generates quote with per-token pricing', () => {
    const route = makeRoute({
      pricingModel: 'per_token',
      perTokenPrice: '500',
      flatPrice: undefined,
    });
    const quote = generateQuote({
      route,
      providerAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
      gatewayBaseUrl: 'http://localhost:3000',
      network: 'mainnet',
      quoteExpirySeconds: 600,
      usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });

    expect(quote.amount).toBe('500');
    expect(quote.pricingModel).toBe('per_token');
    expect(quote.network).toBe('mainnet');
  });

  it('defaults amount to 0 for missing price', () => {
    const route = makeRoute({ flatPrice: undefined, perTokenPrice: undefined });
    const quote = generateQuote({
      route,
      providerAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
      gatewayBaseUrl: 'http://localhost:3000',
      network: 'testnet',
      quoteExpirySeconds: 300,
      usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });

    expect(quote.amount).toBe('0');
  });
});

describe('buildPaymentRequiredResponse', () => {
  it('builds a valid 402 response', () => {
    const route = makeRoute();
    const quote = generateQuote({
      route,
      providerAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
      gatewayBaseUrl: 'http://localhost:3000',
      network: 'testnet',
      quoteExpirySeconds: 300,
      usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });

    const response = buildPaymentRequiredResponse({
      quote,
      gatewayBaseUrl: 'http://localhost:3000',
    });

    expect(response.status).toBe(402);
    expect(response.message).toBe('Payment Required');
    expect(response.quote).toEqual(quote);
    expect(response.instructions).toContain(quote.paymentAddress);
    expect(response.instructions).toContain('X-Payment-Hash');
    expect(response.docs).toBe('http://localhost:3000/docs/x402');
  });
});

describe('calculatePrice', () => {
  it('calculates flat price', () => {
    const route = makeRoute({ flatPrice: '1000000', pricingModel: 'flat' });
    const result = calculatePrice({ route });

    expect(result.amount).toBe('1000000');
    expect(result.asset).toBe('USDC');
  });

  it('calculates per-token price', () => {
    const route = makeRoute({
      perTokenPrice: '100',
      pricingModel: 'per_token',
      flatPrice: undefined,
    });
    const result = calculatePrice({ route, tokenCount: 500 });

    expect(result.amount).toBe('50000');
    expect(result.asset).toBe('USDC');
  });

  it('returns 0 for missing price', () => {
    const route = makeRoute({ flatPrice: undefined });
    const result = calculatePrice({ route });

    expect(result.amount).toBe('0');
  });
});

describe('ReplayProtection', () => {
  it('marks and detects used payments', () => {
    const rp = new ReplayProtection();
    const txHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

    expect(rp.isUsed(txHash)).toBe(false);
    rp.markUsed(txHash, 60);
    expect(rp.isUsed(txHash)).toBe(true);
    expect(rp.size).toBe(1);
  });

  it('tracks multiple payments', () => {
    const rp = new ReplayProtection();
    const hash1 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    const hash2 = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3';

    rp.markUsed(hash1, 60);
    rp.markUsed(hash2, 60);

    expect(rp.isUsed(hash1)).toBe(true);
    expect(rp.isUsed(hash2)).toBe(true);
    expect(rp.size).toBe(2);
  });

  it('auto-expires entries', () => {
    jest.useFakeTimers();
    const rp = new ReplayProtection();
    const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

    rp.markUsed(hash, 1); // 1 second TTL
    expect(rp.isUsed(hash)).toBe(true);

    jest.runAllTimers();
    // After the timer fires, the entry should be removed
    expect(rp.size).toBe(0);

    jest.useRealTimers();
  });
});
