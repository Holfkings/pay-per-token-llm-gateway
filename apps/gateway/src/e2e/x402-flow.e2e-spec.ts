import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

let mockPaymentStore: Record<string, any>[] = [];

function resetMockStore() {
  mockPaymentStore = [];
}

jest.mock('@x402/database', () => ({
  prisma: {
    provider: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'e2e-provider-001',
        walletAddress: 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F',
        active: true,
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
        if (where?.model === 'gpt-4' && where?.active === true) {
          return Promise.resolve({
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
          });
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
  },
  Prisma: {},
}));

const mockPrisma = jest.requireMock('@x402/database').prisma as any;

jest.mock('ioredis', () => ({
  default: jest.fn().mockImplementation(() => ({
    eval: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
    connect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
  Redis: jest.fn().mockImplementation(() => ({
    eval: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
    connect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
}));

const TX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const TX2 = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3';
const TX3 = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4';
const PW = 'GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F';
const PAYER = 'GB4YJON6574K74SGHSKHPMBJDJPLBPYN4HPGGN2J5RFKMSNFSWLBYFRL';

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
          usage: { prompt_tokens: 5, completion_tokens: 12, total_tokens: 17 },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('x402 Gateway E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    global.fetch = createHorizonAndLLMFetch() as any;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('REDIS')
      .useValue({
        eval: jest.fn().mockResolvedValue(1),
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

  it('verifies payment and forwards to upstream LLM', async () => {
    const quoteRes = await request(app.getHttpServer())
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
    expect(res.body.usage.total_tokens).toBe(17);
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

    // Step 1: 402
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(402);

    // Step 2: Pay + retry → confirms payment
    await request(app.getHttpServer())
      .post('/api/v1/chat/completions')
      .set('X-Payment-Hash', replayHash)
      .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'First' }] })
      .expect(200);

    // Step 3: Same payment hash again → found as confirmed, forwarded
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
});
