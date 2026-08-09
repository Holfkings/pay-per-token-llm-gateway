/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

// ── Mock stores ────────────────────────────────

let mockPaymentStore: Record<string, any>[] = [];
let mockAnalyticsStore: Record<string, any>[] = [];

function resetMockStore() {
  mockPaymentStore = [];
  mockAnalyticsStore = [];
}

// ── Route registry for dynamic route resolution ─

const routeRegistry: Record<string, any> = {
  'gpt-4': {
    id: 'e2e-route-001',
    providerId: 'e2e-provider-001',
    path: '/v1/chat/completions',
    upstreamUrl: 'https://api.mock-llm.example.com/v1/chat/completions',
    model: 'gpt-4',
    pricingModel: 'flat',
    flatPrice: '1000000',
    perTokenPrice: null,
    acceptedAssets: ['USDC'],
    rateLimit: 10,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  'gpt-4-per-token': {
    id: 'e2e-route-002',
    providerId: 'e2e-provider-002',
    path: '/v1/chat/completions',
    upstreamUrl: 'https://api.mock-llm.example.com/v1/chat/completions',
    model: 'gpt-4-per-token',
    pricingModel: 'per_token',
    flatPrice: null,
    perTokenPrice: '50',
    acceptedAssets: ['USDC'],
    rateLimit: 10,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  'claude-3': {
    id: 'e2e-route-003',
    providerId: 'e2e-provider-001',
    path: '/v1/chat/completions',
    upstreamUrl: 'https://api.mock-llm.example.com/v1/chat/completions',
    model: 'claude-3',
    pricingModel: 'flat',
    flatPrice: '2000000',
    perTokenPrice: null,
    acceptedAssets: ['USDC'],
    rateLimit: 10,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

jest.mock('@x402/database', () => ({
  prisma: {
    provider: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.id === 'e2e-provider-002') {
          return Promise.resolve({
            id: 'e2e-provider-002',
            walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK4G',
            active: true,
          });
        }
        return Promise.resolve({
          id: 'e2e-provider-001',
          walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
          active: true,
        });
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    route: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const entry = routeRegistry[where?.model];
        if (entry && where?.active === true) {
          return Promise.resolve({ ...entry });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    payment: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const record = {
          id: `pay-${Date.now()}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockPaymentStore.push(record);
        return Promise.resolve(record);
      }),
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.quoteId)
          return Promise.resolve(mockPaymentStore.find((p) => p.quoteId === where.quoteId) || null);
        if (where?.txHash)
          return Promise.resolve(mockPaymentStore.find((p) => p.txHash === where.txHash) || null);
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockPaymentStore)),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        mockPaymentStore = mockPaymentStore.map((p) =>
          p.quoteId === where.quoteId ? { ...p, ...data } : p,
        );
        return Promise.resolve({ count: 1 });
      }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    analyticsEvent: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        mockAnalyticsStore.push({ ...data, createdAt: new Date() });
        return Promise.resolve({});
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockAnalyticsStore)),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0n }, _avg: { responseTime: 0 } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
  Prisma: {},
}));

const mockPrisma = jest.requireMock('@x402/database').prisma as any;

// ── Mock webhook dispatcher ────────────────────

const mockDispatch = jest.fn().mockResolvedValue(['email']);

jest.mock('@x402/notifications', () => ({
  dispatcher: {
    dispatch: jest.fn().mockImplementation((...args: any[]) => mockDispatch(...args)),
  },
  WebhookNotificationHandler: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('ioredis', () => ({
  default: jest.fn().mockImplementation(() => ({
    eval: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    connect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
  Redis: jest.fn().mockImplementation(() => ({
    eval: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    connect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
}));

// ── Constants ──────────────────────────────────

const TX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const TX2 = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3';
const TX4 = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5';
const PW = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F';
const PW2 = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK4G';
const PAYER = 'GB4YJON6574K74SGHSKHPMBJDJPLBPYN4HPGGN2J5RFKMSNFSWLBYFRL';

// ── Fetch mocks ────────────────────────────────

function createHorizonAndLLMFetch() {
  return jest.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/transactions/') && !u.includes('/operations')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: u.split('/transactions/')[1],
          successful: true,
          source_account: PAYER,
          ledger: 12345,
          created_at: new Date().toISOString(),
        }),
      };
    }
    if (u.includes('/operations')) {
      const txId = u.split('/transactions/')[1]?.split('/')[0];
      let amount = '1000000';
      let to = PW;
      if (txId === TX4) { amount = '500000'; to = PW2; }
      if (txId === TX_CROSS) { amount = '2000000'; to = PW; }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            records: [
              {
                type: 'payment',
                from: PAYER,
                to,
                amount,
                asset_code: 'USDC',
                asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                asset_type: 'credit_alphanum4',
              },
            ],
          },
        }),
      };
    }
    if (u.includes('mock-llm')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-e2e-test',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from x402 gateway E2E test!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 300, total_tokens: 500 },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Core Flow Tests (existing scenarios)
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Core Flow', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('returns 402 with quote when no payment header', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] })
      .expect(402);

    expect(res.body.status).toBe(402);
    expect(res.body.quote).toBeDefined();
    expect(res.body.quote.amount).toBe('1000000');
    expect(res.body.quote.asset).toBe('USDC');
    expect(res.body.quote.paymentAddress).toBe(PW);
    expect(res.body.instructions).toContain('X-Payment-Hash');
    expect(mockPrisma.payment.create).toHaveBeenCalled();
  });

  it('returns 404 for unknown model', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'nonexistent', messages: [{ role: 'user', content: 'Hi' }] })
      .expect(404);
  });

  it('returns 400 for invalid body', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ invalid: true })
      .expect(400);
  });

  it('returns 400 for missing model field', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hi' }] })
      .expect(400);
  });

  it('returns 400 for empty messages array', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [] })
      .expect(400);
  });

  it('verifies payment and forwards to upstream LLM', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] })
      .expect(402);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', TX)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] })
      .expect(200);

    expect(res.body.id).toBe('chatcmpl-e2e-test');
    expect(res.body.choices[0].message.content).toContain('x402 gateway');
    expect(res.body.usage.total_tokens).toBe(500);
    expect(res.headers['x-request-trace-id']).toBeDefined();

    const receipt = JSON.parse(res.headers['x-payment-receipt']);
    expect(receipt.txHash).toBe(TX);
    expect(receipt.status).toBe('confirmed');
    expect(typeof receipt.quoteId).toBe('string');
  });

  it('rejects invalid payment hash', async () => {
    const orig = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as any;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] })
        .expect(402);

      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .set('X-Payment-Hash', 'bad' + '0'.repeat(60))
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] })
        .expect(402);

      expect(res.body.message).toContain('verification failed');
    } finally {
      global.fetch = orig;
    }
  });

  it('GET /api/v1/payments/:quoteId/status returns payment status', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'status' }] })
      .expect(402);

    const s = await request(app.getHttpServer())
      .get(`/api/v1/payments/${r.body.quote.id}/status`)
      .expect(200);

    expect(s.body.quoteId).toBe(r.body.quote.id);
    expect(s.body.status).toBe('pending');
  });

  it('POST /api/v1/x402/verify verifies a payment', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'verify' }] })
      .expect(402);

    const v = await request(app.getHttpServer())
      .post('/api/v1/x402/verify')
      .send({ txHash: TX2, quoteId: r.body.quote.id })
      .expect(200);

    expect(v.body.verified).toBe(true);
    expect(v.body.txHash).toBe(TX2);
    expect(v.body.payerAddress).toBe(PAYER);
  });

  it('accepts confirmed payment replay idempotently', async () => {
    const replayHash = 'f' + 'a'.repeat(63);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(402);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', replayHash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', replayHash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Second' }] })
      .expect(200);

    expect(res.body.id).toBe('chatcmpl-e2e-test');
  });

  it('returns SSE stream for streaming requests', async () => {
    const streamHash = 'e' + 'b'.repeat(63);
    const orig = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/transactions/') && !u.includes('/operations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: streamHash,
            successful: true,
            source_account: PAYER,
            ledger: 12345,
            created_at: new Date().toISOString(),
          }),
        };
      }
      if (u.includes('/operations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  from: PAYER,
                  to: PW,
                  amount: '1000000',
                  asset_code: 'USDC',
                  asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                  asset_type: 'credit_alphanum4',
                },
              ],
            },
          }),
        };
      }
      if (u.includes('mock-llm')) {
        const sse = `data: {"id":"s1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"},"index":0}]}\n\ndata: [DONE]\n\n`;
        const stream = new ReadableStream({
          start(c: any) {
            c.enqueue(new TextEncoder().encode(sse));
            c.close();
          },
        });
        return { ok: true, status: 200, body: stream };
      }
      return { ok: false, status: 404 };
    }) as any;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 's' }], stream: true })
        .expect(402);

      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .set('X-Payment-Hash', streamHash)
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 's' }], stream: true })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('data: [DONE]');
      expect(res.headers['x-request-trace-id']).toBeDefined();
    } finally {
      global.fetch = orig;
    }
  });

  it('returns 402 for streaming requests without payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'stream' }], stream: true })
      .expect(402);

    expect(res.body.status).toBe(402);
    expect(res.body.quote).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Per-Token Metered Pricing Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Per-Token Metered Pricing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('returns 402 with estimated cost based on max_tokens for per-token route', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({
        model: 'gpt-4-per-token',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
      })
      .expect(402);

    expect(res.body.status).toBe(402);
    expect(res.body.quote).toBeDefined();
    expect(res.body.quote.asset).toBe('USDC');
    expect(res.body.quote.paymentAddress).toBe(PW2);
    // 1000 tokens × 50 stroops = 50000 stroops
    expect(res.body.quote.amount).toBe('50000');
  });

  it('uses default token estimate when max_tokens omitted for per-token route', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({
        model: 'gpt-4-per-token',
        messages: [{ role: 'user', content: 'Hello' }],
      })
      .expect(402);

    expect(res.body.status).toBe(402);
    expect(res.body.quote.amount).toBeDefined();
    expect(parseInt(res.body.quote.amount)).toBeGreaterThan(0);
  });

  it('forwards per-token request and returns actual cost headers', async () => {
    // Step 1: Get 402 quote
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'Test' }] })
      .expect(402);

    // Step 2: Pay and forward
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', TX4)
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'Test' }] })
      .expect(200);

    expect(res.headers['x-actual-cost']).toBeDefined();
    expect(res.headers['x-tokens-used']).toBe('500');
    expect(res.headers['x-paid-amount']).toBeDefined();

    const receipt = JSON.parse(res.headers['x-payment-receipt']);
    expect(receipt.actualCost).toBeDefined();
    expect(receipt.tokensUsed).toBe(500);
  });

  it('returns surplus header when user overpays for per-token route', async () => {
    // TX4 pays 500000 stroops but 500 tokens × 50 = 25000 stroops
    // Surplus = 500000 - 25000 = 475000 stroops
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'Overpay' }] })
      .expect(402);

    const overpayHash = '9' + 'c'.repeat(63);
    const orig = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/transactions/') && !u.includes('/operations')) {
        return {
          ok: true, status: 200,
          json: async () => ({ id: overpayHash, successful: true, source_account: PAYER, ledger: 12345, created_at: new Date().toISOString() }),
        };
      }
      if (u.includes('/operations')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            _embedded: { records: [{ type: 'payment', from: PAYER, to: PW2, amount: '500000', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', asset_type: 'credit_alphanum4' }] },
          }),
        };
      }
      if (u.includes('mock-llm')) {
        return {
          ok: true, status: 200,
          json: async () => ({ id: 'chatcmpl-overpay', object: 'chat.completion', model: 'gpt-4-per-token', choices: [{ index: 0, message: { role: 'assistant', content: 'Short' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 } }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .set('X-Payment-Hash', overpayHash)
        .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'Overpay' }] })
        .expect(200);

      expect(res.headers['x-surplus']).toBeDefined();
      expect(parseInt(res.headers['x-surplus'])).toBeGreaterThan(0);
    } finally {
      global.fetch = orig;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cross-Route Replay Protection Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Cross-Route Replay Protection', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('rejects a payment confirmed on one route when used on a different route', async () => {
    // Step 1: Pay for gpt-4 (route-001, PW) with a fresh hash
    const crossHash = 'c0' + 'e'.repeat(62);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Route A' }] })
      .expect(402);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', crossHash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Route A' }] })
      .expect(200);

    // Step 2: Try same hash on claude-3 (route-003) — should be rejected
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Route B' }] })
      .expect(402);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', crossHash)
      .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Route B' }] })
      .expect(402);

    expect(res.body.message).toMatch(/different route/i);
  });

  it('allows same payment on same route (replay idempotency)', async () => {
    const hash = '1' + 'd'.repeat(63);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(402);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Second' }] })
      .expect(200);

    expect(res.body.id).toBe('chatcmpl-e2e-test');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Analytics Event Recording Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Analytics Events', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('records an unpaid request event on 402 response', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Analytics test' }] })
      .expect(402);

    const unpaidEvents = mockAnalyticsStore.filter((e) => e.type === 'request:unpaid');
    expect(unpaidEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('records a paid request event on successful payment flow', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Paid analytics' }] })
      .expect(402);

    const hash = '2' + 'e'.repeat(63);
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Paid analytics' }] })
      .expect(200);

    const paidEvents = mockAnalyticsStore.filter((e) => e.type === 'request:paid');
    expect(paidEvents.length).toBeGreaterThanOrEqual(1);
    expect(paidEvents[0].callerAddress).toBeDefined();
  });

  it('records analytics for per-token paid requests with actual cost', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'PT analytics' }] })
      .expect(402);

    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', TX4)
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'PT analytics' }] })
      .expect(200);

    const paidEvents = mockAnalyticsStore.filter((e) => e.type === 'request:paid');
    expect(paidEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Webhook Notification Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Webhook Notifications', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    mockDispatch.mockClear();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('dispatches payment_received webhook on successful verification', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Webhook test' }] })
      .expect(402);

    const hash = '4' + 'b'.repeat(63);
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Webhook test' }] })
      .expect(200);

    // Wait for async webhook dispatch
    await new Promise((r) => setTimeout(r, 100));

    const paymentReceivedCalls = mockDispatch.mock.calls.filter(
      (call: any[]) => call[0]?.event === 'payment_received',
    );
    expect(paymentReceivedCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('dispatches verification_failed webhook on rejected payment', async () => {
    const orig = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as any;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Fail webhook' }] })
        .expect(402);

      await request(app.getHttpServer())
        .post('/api/v1/chat/completions')
        .set('X-Payment-Hash', 'bad' + 'f'.repeat(60))
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Fail webhook' }] })
        .expect(402);

      await new Promise((r) => setTimeout(r, 100));

      const failCalls = mockDispatch.mock.calls.filter(
        (call: any[]) => call[0]?.event === 'verification_failed',
      );
      expect(failCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      global.fetch = orig;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Rate Limiting Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Rate Limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(0),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Rate limit' }] })
      .expect(429);
  });

  it('returns retryAfter in 429 response', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Rate limit 2' }] })
      .expect(429);

    expect(res.body.retryAfter).toBeDefined();
    expect(typeof res.body.retryAfter).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Payment Receipt Verification Tests
// ═══════════════════════════════════════════════════════════════════

describe('x402 Gateway E2E — Payment Receipts', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        connect: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider('PRISMA')
      .useValue(mockPrisma)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockStore();
    jest.clearAllMocks();
    global.fetch = createHorizonAndLLMFetch() as any;
  });

  it('includes complete receipt headers on flat-rate responses', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Receipt test' }] })
      .expect(402);

    const hash = '5' + 'a'.repeat(63);
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Receipt test' }] })
      .expect(200);

    const receipt = JSON.parse(res.headers['x-payment-receipt']);
    expect(receipt.id).toBeDefined();
    expect(receipt.quoteId).toBeDefined();
    expect(receipt.txHash).toBe(hash);
    expect(receipt.payerAddress).toBe(PAYER);
    expect(receipt.amount).toBeDefined();
    expect(receipt.asset).toBe('USDC');
    expect(receipt.status).toBe('confirmed');
    expect(receipt.actualCost).toBeDefined();
  });

  it('includes actualCost and tokensUsed on per-token receipts', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'PT receipt' }] })
      .expect(402);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', TX4)
      .send({ model: 'gpt-4-per-token', messages: [{ role: 'user', content: 'PT receipt' }] })
      .expect(200);

    const receipt = JSON.parse(res.headers['x-payment-receipt']);
    expect(receipt.actualCost).toBeDefined();
    expect(receipt.tokensUsed).toBe(500);
    expect(receipt.status).toBe('confirmed');
  });

  it('returns X-Request-Trace-Id on successful payment responses', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Trace' }] })
      .expect(402);

    const hash = '7' + 'd'.repeat(63);
    const res200 = await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', hash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Trace' }] })
      .expect(200);

    expect(res200.headers['x-request-trace-id']).toBeDefined();
  });
});


