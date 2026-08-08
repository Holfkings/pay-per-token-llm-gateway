// ──────────────────────────────────────────────
// @x402/config — Centralized configuration
// ──────────────────────────────────────────────

import type { StellarNetwork, PaymentAsset } from '@x402/types';

export interface GatewayConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Node environment */
  nodeEnv: 'development' | 'production' | 'test';

  /** Stellar configuration */
  stellar: {
    /** Network to use */
    network: StellarNetwork;
    /** Horizon server URL */
    horizonUrl: string;
    /** Soroban RPC URL */
    sorobanRpcUrl: string;
    /** Network passphrase */
    networkPassphrase: string;
  };

  /** Database */
  database: {
    url: string;
  };

  /** Redis */
  redis: {
    url: string;
    /** Payment verification cache TTL (seconds) */
    paymentCacheTtl: number;
    /** Rate limit window (seconds) */
    rateLimitWindow: number;
    /** Max unpaid requests per window */
    rateLimitMax: number;
  };

  /** Default payment configuration */
  payment: {
    /** Default asset for payments */
    defaultAsset: PaymentAsset;
    /** USDC issuer address */
    usdcIssuer: string;
    /** Quote expiry time (seconds) */
    quoteExpirySeconds: number;
    /** Minimum payment amount in stroops (smallest unit) */
    minPaymentAmount: string;
  };

  /** Upstream LLM configuration */
  llm: {
    /** Request timeout for non-streaming requests (ms) */
    requestTimeout: number;
    /** Timeout for streaming requests (ms). Defaults to 10 minutes. */
    streamTimeout?: number;
    /** Max retries for failed upstream calls */
    maxRetries: number;
  };

  /** Notification configuration */
  notifications: {
    email: {
      enabled: boolean;
      smtpHost?: string;
      smtpPort?: number;
      fromAddress?: string;
    };
    webhook: {
      enabled: boolean;
      retryCount: number;
      retryDelayMs: number;
    };
  };

  /** Security */
  security: {
    /** JWT secret for dashboard sessions */
    jwtSecret: string;
    /** Session duration (seconds) */
    sessionDuration: number;
    /** CORS origins */
    corsOrigins: string[];
  };
}

/**
 * Load configuration from environment variables with sane defaults.
 */
export function loadConfig(): GatewayConfig {
  const nodeEnv = (process.env.NODE_ENV as GatewayConfig['nodeEnv']) || 'development';
  const network = (process.env.STELLAR_NETWORK as StellarNetwork) || 'testnet';

  const networkConfigs: Record<
    StellarNetwork,
    { horizon: string; rpc: string; passphrase: string }
  > = {
    testnet: {
      horizon: 'https://horizon-testnet.stellar.org',
      rpc: 'https://soroban-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    },
    mainnet: {
      horizon: 'https://horizon.stellar.org',
      rpc: 'https://soroban-mainnet.stellar.org',
      passphrase: 'Public Global Stellar Network ; September 2015',
    },
    futurenet: {
      horizon: 'https://horizon-futurenet.stellar.org',
      rpc: 'https://rpc-futurenet.stellar.org',
      passphrase: 'Test SDF Future Network ; October 2022',
    },
  };

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv,

    stellar: {
      network,
      horizonUrl: process.env.HORIZON_URL || networkConfigs[network].horizon,
      sorobanRpcUrl: process.env.SOROBAN_RPC_URL || networkConfigs[network].rpc,
      networkPassphrase: networkConfigs[network].passphrase,
    },

    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/x402_gateway',
    },

    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      paymentCacheTtl: parseInt(process.env.PAYMENT_CACHE_TTL || '3600', 10),
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10),
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
    },

    payment: {
      defaultAsset: 'USDC',
      usdcIssuer:
        process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      quoteExpirySeconds: parseInt(process.env.QUOTE_EXPIRY_SECONDS || '300', 10),
      minPaymentAmount: process.env.MIN_PAYMENT_AMOUNT || '10000', // 0.00001 XLM in stroops
    },

    llm: {
      requestTimeout: parseInt(process.env.LLM_REQUEST_TIMEOUT || '120000', 10),
      streamTimeout: process.env.LLM_STREAM_TIMEOUT
        ? parseInt(process.env.LLM_STREAM_TIMEOUT, 10)
        : undefined,
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '2', 10),
    },

    notifications: {
      email: {
        enabled: process.env.EMAIL_ENABLED === 'true',
        smtpHost: process.env.SMTP_HOST,
        smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
        fromAddress: process.env.EMAIL_FROM,
      },
      webhook: {
        enabled: process.env.WEBHOOK_ENABLED !== 'false',
        retryCount: parseInt(process.env.WEBHOOK_RETRY_COUNT || '3', 10),
        retryDelayMs: parseInt(process.env.WEBHOOK_RETRY_DELAY || '1000', 10),
      },
    },

    security: {
      jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      sessionDuration: parseInt(process.env.SESSION_DURATION || '86400', 10),
      corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3001').split(','),
    },
  };
}

/** Shared singleton config instance */
let _config: GatewayConfig | null = null;

export function getConfig(): GatewayConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function setConfig(config: GatewayConfig): void {
  _config = config;
}
