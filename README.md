# x402 LLM Gateway

**Pay-per-request LLM gateway using x402 stablecoin micropayments on Stellar.**

No API keys. No subscriptions. No rate limits. Just pay USDC (or XLM) on Stellar to access any LLM endpoint — self-hosted or third-party.

When a request arrives without payment, the gateway returns **HTTP 402 Payment Required** with a Stellar payment address and price quote. The client pays on-chain, retries with the transaction hash, and the gateway verifies the payment before forwarding to the upstream LLM.

---

## Architecture

```
┌──────────────┐     402 + Quote      ┌──────────────────┐
│              │ ◄─────────────────── │                  │
│   Caller     │                      │   x402 Gateway   │
│  (Agent/App) │ ──── Pay USDC ──────►│   (NestJS)       │
│              │                      │                  │
└──────────────┘                      └────────┬─────────┘
                                      │        │
                              ┌───────┘        └──────────┐
                              ▼                            ▼
                     ┌────────────────┐          ┌─────────────────┐
                     │   Stellar      │          │   Upstream LLM  │
                     │   (Horizon/    │          │   (OpenAI/etc)  │
                     │   Soroban)     │          │                 │
                     └────────────────┘          └─────────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │   Provider     │
                     │   Dashboard    │
                     │   (Next.js)    │
                     └────────────────┘
```

### Flow

1. **Request**: Caller sends LLM API request to gateway
2. **402 Response**: Gateway returns price quote + Stellar payment address
3. **Payment**: Caller pays USDC on Stellar, gets transaction hash
4. **Retry**: Caller resends request with `X-Payment-Hash` header
5. **Verify**: Gateway queries Horizon for the transaction, validates amount/asset/destination
6. **Forward**: Gateway proxies the request to the upstream LLM
7. **Response**: LLM response returned to caller with payment receipt

---

## Monorepo Structure

```
x402-llm-gateway/
├── apps/
│   ├── gateway/          # NestJS gateway server (core proxy)
│   ├── dashboard/        # Next.js provider dashboard
│   └── explorer/         # Payment/request explorer
│
├── contracts/            # Soroban smart contracts (Rust)
│   ├── payment-verifier/ # On-chain payment recording
│   ├── credit-escrow/    # Prepaid credit balances
│   └── multisig/         # Provider payout wallet security
│
├── packages/             # Shared libraries
│   ├── types/            # TypeScript type definitions
│   ├── x402-core/        # x402 protocol implementation
│   ├── config/           # Centralized configuration
│   ├── logger/           # Structured logging
│   ├── validation/       # Zod schemas
│   ├── database/         # Prisma client + schema
│   ├── wallet/           # Stellar wallet utilities
│   ├── authentication/   # Wallet-based auth
│   ├── analytics/        # Usage & revenue analytics
│   ├── notifications/    # Email/webhook/in-app notifications
│   ├── sdk/              # Client SDK (402→pay→retry)
│   ├── ui/               # Shared UI utilities
│   └── shared/           # General utilities
│
├── infrastructure/
│   ├── docker/           # Dockerfiles + compose
│   ├── kubernetes/       # K8s manifests (future)
│   ├── terraform/        # IaC (future)
│   └── monitoring/       # Monitoring configs (future)
│
├── scripts/              # Dev/build scripts
├── tests/                # E2E, integration, load tests
├── .github/workflows/    # CI/CD pipelines
└── README.md
```

---

## Quickstart

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 8
- **PostgreSQL** ≥ 16
- **Redis** ≥ 7
- **Rust** (for Soroban contracts, optional)

### 1. Clone and Install

```bash
git clone https://github.com/your-org/x402-llm-gateway.git
cd x402-llm-gateway

# Install dependencies
pnpm install

# Generate Prisma client
cd packages/database && npx prisma generate && cd ../..

# Copy environment
cp .env.example .env
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL and Redis locally, or use Docker:
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis
```

### 3. Set Up Database

```bash
# Push schema to database
cd packages/database && npx prisma db push && cd ../..
```

### 4. Run the Gateway

```bash
pnpm dev:gateway
# Gateway runs at http://localhost:3000
# Swagger docs at http://localhost:3000/api/docs
```

### 5. Run the Dashboard

```bash
pnpm dev:dashboard
# Dashboard runs at http://localhost:3001
```

### 6. Test the Flow

```bash
# Without payment (expect 402)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

---

## API Reference

### Proxy Endpoint

```
POST /v1/chat/completions
Headers:
  X-Payment-Hash: <stellar_tx_hash>    # After paying
  Content-Type: application/json

Body: OpenAI-compatible chat completion request
```

### 402 Response

```json
{
  "status": 402,
  "message": "Payment Required",
  "quote": {
    "id": "uuid",
    "route": "/v1/chat/completions",
    "pricingModel": "flat",
    "amount": "1000000",
    "asset": "USDC",
    "paymentAddress": "G...",
    "expiresAt": 1712345678,
    "network": "testnet"
  },
  "instructions": "To pay:\n1. Send 1000000 USDC to G...\n2. Retry with X-Payment-Hash header",
  "docs": "http://localhost:3000/docs/x402"
}
```

### Payment Verification

```
POST /api/v1/x402/verify
Body: { "txHash": "...", "quoteId": "..." }

GET /api/v1/payments/:quoteId/status
```

### Provider Management

```
GET    /api/v1/providers
POST   /api/v1/providers
GET    /api/v1/providers/:id
PUT    /api/v1/providers/:id
DELETE /api/v1/providers/:id
```

### Route Management

```
GET    /api/v1/routes
POST   /api/v1/routes
GET    /api/v1/routes/:id
PUT    /api/v1/routes/:id
DELETE /api/v1/routes/:id
```

---

## Using the Client SDK

```typescript
import { X402Client } from '@x402/sdk';

const client = new X402Client({
  gatewayUrl: 'https://my-gateway.example.com',
  secretKey: 'S...', // Your Stellar secret key for auto-pay
  network: 'testnet',
});

const result = await client.call({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Explain x402 in one sentence.' }],
});

if (result.success) {
  console.log(result.response.choices[0].message.content);
  console.log(`Cost: ${result.cost.amount} ${result.cost.asset}`);
} else {
  console.error(result.error);
}
```

---

## Deploying the Contracts

```bash
# Install Soroban CLI
cargo install --locked stellar-cli --features opt

# Build
cd contracts/payment-verifier
stellar contract build

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_verifier.wasm \
  --source S... \
  --network testnet
```

---

## Environment Variables

| Variable               | Default                               | Description                  |
| ---------------------- | ------------------------------------- | ---------------------------- |
| `STELLAR_NETWORK`      | `testnet`                             | Stellar network to use       |
| `HORIZON_URL`          | `https://horizon-testnet.stellar.org` | Horizon API endpoint         |
| `SOROBAN_RPC_URL`      | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint         |
| `DATABASE_URL`         | `postgresql://...`                    | PostgreSQL connection string |
| `REDIS_URL`            | `redis://...`                         | Redis connection string      |
| `PORT`                 | `3000`                                | Gateway server port          |
| `USDC_ISSUER`          | `GBBD...`                             | Stellar USDC issuer address  |
| `JWT_SECRET`           | —                                     | Secret for session tokens    |
| `QUOTE_EXPIRY_SECONDS` | `300`                                 | Time before quotes expire    |
| `LLM_REQUEST_TIMEOUT`  | `120000`                              | Upstream LLM timeout (ms)    |

---

## Roadmap

### v1 (Current)

- [x] Gateway reverse proxy with 402 flow
- [x] Flat-rate pricing per route/model
- [x] Stellar payment verification via Horizon
- [x] Replay protection
- [x] JS/TS Client SDK
- [x] Provider dashboard (Next.js)
- [x] Payment history & analytics
- [x] Webhook notifications

### v2 (Planned)

- [ ] Per-token metered pricing
- [ ] Prepaid credit escrow contract (done — needs integration)
- [ ] Multi-provider routing
- [ ] Python SDK + LangChain integration
- [ ] Multisig provider payout wallets
- [ ] Streaming (SSE) support
- [ ] Kubernetes deployment manifests

---

## Security

- **Never trust the client**: All payments are verified on-chain via Horizon/Soroban RPC
- **Replay protection**: Each transaction hash is tracked and can only be used once
- **Rate limiting**: Unpaid 402 requests are rate-limited to prevent spam
- **Audit logs**: All payment verifications and forwarded requests are logged
- **Environment isolation**: Upstream API keys are stored as environment variables, never exposed

### Security Considerations for Production

1. **Always verify on-chain** — never trust client-submitted payment proofs
2. **Use Redis for replay protection** — the in-memory implementation is for development only
3. **Run behind a reverse proxy** (nginx/Caddy) for TLS termination
4. **Rotate JWT secrets** regularly
5. **Use separate Horizon/Soroban API keys** for rate limit management on mainnet
6. **Implement circuit breakers** for upstream LLM failures
7. **Set up monitoring + alerting** for payment verification failures

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit conventions, and review process.

## License

MIT License — see [LICENSE](./LICENSE) for details.

---

Built with ❤️ on [Stellar](https://stellar.org) — the blockchain for real-world payments.
