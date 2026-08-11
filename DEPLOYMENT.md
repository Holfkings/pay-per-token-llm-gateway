# x402 LLM Gateway — Deployment Guide

This guide covers deploying the two components of the x402 LLM Gateway:

| Component               | Platform | Type       | Why                                                           |
| ----------------------- | -------- | ---------- | ------------------------------------------------------------- |
| **Gateway** (NestJS)    | Railway  | Container  | Long-running server with WebSockets, needs PostgreSQL + Redis |
| **Dashboard** (Next.js) | Vercel   | Serverless | Next.js is natively supported with zero config                |

---

## Prerequisites

- GitHub repository with the code pushed
- A Stellar testnet account with secret key (generate one with the Stellar CLI: `stellar keys generate --global my-account --network testnet`, then fund it from the [Stellar testnet faucet](https://laboratory.stellar.org/#account-creator?network=test))
- Upstream LLM API key (e.g., OpenAI API key)

---

## Part 1: Deploy Gateway to Railway

### 1.1 Create Railway Account

Go to [railway.app](https://railway.app) and sign up with GitHub.

### 1.2 Add PostgreSQL and Redis

1. Click **New Project** → **Deploy from GitHub repo**
2. Select your x402-llm-gateway repository
3. Click **+ New** → **Database** → **Add PostgreSQL**
4. Click **+ New** → **Database** → **Add Redis**

### 1.3 Configure the Gateway Service

1. Select the gateway service from your repo
2. Under **Settings** → **Environment**, add:

| Variable                            | Value                                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| `NODE_ENV`                          | `production`                                               |
| `STELLAR_NETWORK`                   | `testnet`                                                  |
| `DATABASE_URL`                      | `${{Postgres.DATABASE_URL}}` (Railway reference)           |
| `REDIS_URL`                         | `${{Redis.REDIS_URL}}` (Railway reference)                 |
| `JWT_SECRET`                        | (Generate: `openssl rand -base64 32`)                      |
| `USDC_ISSUER`                       | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| `CORS_ORIGINS`                      | `https://your-dashboard.vercel.app`                        |
| `UPSTREAM_API_KEY_YOUR_PROVIDER_ID` | `sk-your-openai-api-key`                                   |
| `PORT`                              | `3000`                                                     |

3. Under **Settings** → **Build**, set:
   - **Dockerfile path**: `infrastructure/docker/Dockerfile.gateway`

4. Under **Settings** → **Deploy**, set:
   - **Health Check Path**: `/health`

### 1.4 Deploy

Click **Deploy**. The gateway will:

1. Build the Docker image
2. Connect to PostgreSQL and Redis
3. Run Prisma migrations
4. Start on port 3000

Note the gateway URL (e.g., `https://x402-gateway.up.railway.app`).

---

## Part 2: Deploy Dashboard to Vercel

### 2.1 Create Vercel Account

Go to [vercel.com](https://vercel.com) and sign up with GitHub.

### 2.2 Import the Project

1. Click **Add New** → **Project**
2. Select your x402-llm-gateway repository
3. Configure:

| Setting            | Value            |
| ------------------ | ---------------- |
| **Framework**      | Next.js          |
| **Root Directory** | `apps/dashboard` |

Leave **Build Command** and **Output Directory** empty — they're provided by
`apps/dashboard/vercel.json` (`pnpm exec next build` outputs `.next` inside
`apps/dashboard`, which is exactly where Vercel looks for it).

> ⚠️ Keep the build command as `next build` — not `nx build dashboard`.
> Vercel runs the command from the Root Directory (`apps/dashboard`), and the
> Nx `@nx/next:build` executor fails there with
> `ENOENT: scandir 'apps/dashboard/public'` on a cold cache.

### 2.3 Set Environment Variables

| Variable                  | Value                                 |
| ------------------------- | ------------------------------------- |
| `NEXT_PUBLIC_GATEWAY_URL` | `https://your-gateway.up.railway.app` |

> ⚠️ This value is baked into the client bundle at **build time**, so set it in
> the Vercel project → **Settings → Environment Variables** **before** the first
> build. If the gateway isn't deployed yet, use its future URL — the dashboard
> builds fine without it, but API calls will fail until it points at a live
> gateway.

### 2.4 Deploy

Click **Deploy**. Vercel will install the monorepo dependencies (via
`pnpm install --frozen-lockfile`), build the dashboard with `next build`, and
serve the `.next` output.

---

## Part 3: Initialize the Gateway

Once both services are deployed, initialize the gateway:

### 3.1 Create a Provider

```bash
curl -X POST https://your-gateway.up.railway.app/api/v1/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "My LLM Provider",
    "walletAddress": "YOUR_STELLAR_WALLET_ADDRESS",
    "payoutWalletAddress": "YOUR_PAYOUT_WALLET_ADDRESS"
  }'
```

### 3.2 Create a Route

```bash
curl -X POST https://your-gateway.up.railway.app/api/v1/routes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "providerId": "PROVIDER_ID_FROM_ABOVE",
    "path": "/v1/chat/completions",
    "upstreamUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4",
    "pricingModel": "flat",
    "flatPrice": "1000000",
    "acceptedAssets": ["USDC"],
    "rateLimit": 10
  }'
```

---

## Part 4: Test the x402 Payment Flow

### 4.1 Send Request Without Payment (Expect 402)

```bash
curl -X POST https://your-gateway.up.railway.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

**Expected Response (402):**

```json
{
  "status": 402,
  "message": "Payment Required",
  "quote": {
    "id": "...",
    "amount": "1000000",
    "asset": "USDC",
    "paymentAddress": "GA5ZSE...",
    "network": "testnet"
  }
}
```

### 4.2 Pay on Stellar Testnet

Using the Stellar CLI or any Stellar wallet, send the quoted amount to the payment address:

```bash
stellar tx new --source alice --network testnet \
  --op payment --destination YOUR_GATEWAY_ADDRESS \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --amount 0.1
```

### 4.3 Retry Request with Payment Hash

```bash
curl -X POST https://your-gateway.up.railway.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Payment-Hash: YOUR_TRANSACTION_HASH" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### 4.4 Expected Success Response

The gateway verifies the payment on-chain and proxies to the LLM:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [...],
  "usage": {...}
}
```

---

## Deployed Contract Addresses (Testnet)

| Contract         | Address                                                    |
| ---------------- | ---------------------------------------------------------- |
| payment-verifier | `CDHGI3A2BXRC5AQDPWEEXUDQMDXTDZYBCLJZWSE5XZKMVEGJ5LLHA4CZ` |
| credit-escrow    | `CCE7AWVXPO57W5KDONOPMHDV4S5UBUBMHNJVSAVPL7AZGMD4WQN6WVAP` |
| multisig         | `CDMBVMMNJVAJVAV3T2TAL2TAACGTKYUS45RXNLCYKYUC3VGHBI66NWAA` |

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   Vercel         │     │   Railway         │
│   Dashboard      │────▶│   Gateway         │
│   (Next.js)      │     │   (NestJS)        │
└──────────────────┘     └───────┬──────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Postgres │ │  Redis   │ │ Stellar  │
              │ (Railway)│ │ (Railway)│ │ Testnet  │
              └──────────┘ └──────────┘ └──────────┘
```
