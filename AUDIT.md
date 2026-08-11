# 🔍 Comprehensive Audit Report: x402 LLM Gateway

**Audited:** `pay-per-token-llm-gateway` monorepo (Soroban contracts + NestJS gateway + Next.js dashboard + 12 shared packages)
**Date:** August 11, 2026 · **Branch:** `main` (13 commits)
**Method:** Full source review of all contracts, gateway modules, packages, dashboard pages, CI/CD, deployment configs, and docs; plus live execution of the entire test matrix.

---

## ✅ 0. Verification Results (what was actually run)

Everything below was executed in the audit environment, not assumed:

| Check                                           | Result                          |
| ----------------------------------------------- | ------------------------------- |
| `nx run-many --target=lint --all` (15 projects) | ✅ Pass (10 warnings, 0 errors) |
| Gateway unit tests                              | ✅ 111/111 passing (8 suites)   |
| `x402-core` tests                               | ✅ 48/48 passing                |
| Gateway E2E suite (`x402-flow.e2e-spec.ts`)     | ✅ 33/33 passing                |
| Soroban `credit-escrow` contract tests          | ✅ 34/34 passing (cargo test)   |
| Gateway production build (esbuild bundle)       | ✅ 7 MB single-file bundle      |
| Dashboard production build (Next.js)            | ✅ All 8 routes static          |
| CI workflow coverage thresholds                 | ✅ Configured & enforced        |

**Verdict on baseline health: this is a _working, green_ codebase — unusually so for a pre-grant OSS project.** The issues below are hardening/completeness gaps, not "it doesn't run."

---

## 🚨 1. Issues by Severity

### 🔴 Critical / High

**H1. `deploy_contracts` CI job deploys contracts but NEVER calls `init()` and never persists new addresses.**
`.github/workflows/deploy.yml` runs `stellar contract deploy` for all three contracts, but none of them are initialized (`payment-verifier` needs `init(admin)`, `credit-escrow` needs `init(admin, asset)`, `multisig` needs `init(signers, threshold, token)`). A deployed-but-uninitialized contract is unusable (every call panics with unwrap on missing CONFIG). Additionally, the newly deployed IDs are echoed to logs but **never written back** to `contracts/deployed-addresses.json` or config — so the gateway keeps pointing at the old hardcoded addresses (in `packages/config`). The whole "deploy contracts" job currently produces orphaned, uninitialized wasm instances.
**Fix:** After deploy, invoke `init` with the configured admin/asset (from `STELLAR_SECRET_KEY`), then write the new contract IDs back to `contracts/deployed-addresses.json` (and have `@x402/config` read from it, or document that env vars must be updated).

**H2. `AUTH_DEV_MODE` + hardcoded dev wallet in the dashboard login flow.**
The dashboard's `getWalletAddress()`/`signChallenge()` fall back to a fixed testnet address `GA5ZSE6...` + a `dev-sig-` base64 signature whenever `NODE_ENV === 'development'`. This is explicitly gated and documented, and the gateway requires `AUTH_DEV_MODE=true` separately — good defense-in-depth. **However:** the fallback address is the _same constant_ used in the README/DEPLOYMENT.md examples, and a production dashboard could ship with `NODE_ENV=development` if misconfigured (Vercel sets it correctly, but Docker users may not). The two-flag design is correct, but consider a warning banner and making the dev address configurable via `NEXT_PUBLIC_DEV_WALLET` instead of a hardcoded constant.

**H3. Per-token underpayment is detected but not prevented — no enforcement mechanism exists.**
`applyMeteredPricing()` computes `isUnderpaid` for per-token routes and logs a warning, but the caller has _already received the full LLM response_ at that point. There is no mechanism to block future access, hold the deposit, or settle via the credit-escrow contract. `ESCROW_SETTLEMENT_ENABLED` exists in config but **no gateway code calls the credit-escrow contract** — `charge`/`refund`/`withdraw_revenue` are implemented in Rust with tests but completely unwired in the NestJS app. This is the biggest feature/revenue-protection gap vs. the README claims ("gateway charges actual cost from the caller's escrow balance and auto-refunds surplus").
**Fix:** Implement the settlement path in the gateway (`contract-client.ts` counterpart for credit-escrow) gated behind `escrowSettlementEnabled`, or remove the config flag and README claims until it exists.

**H4. SDK `signTransaction` external-signer path is a stub that always errors.**
`X402Client.executePayment()`:

```ts
if (this.config.signTransaction) {
  return {
    success: false,
    error: 'External wallet signing not yet implemented — provide a secretKey',
  };
}
```

The `X402ClientConfig.signTransaction` interface is advertised in `@x402/types`, and README claims "Stellar wallet integration (secret key or external signer)". **External signer support is broken by design.** For an "agent-native" payment SDK this is the primary integration path (agents can't hold secret keys).
**Fix:** Implement it — build the tx via `buildPaymentTransaction`, hand `txXdr` to `signTransaction`, then submit the signed XDR. ~15 lines.

### 🟠 Medium

**M1. `get_usage` / `get_payments` / `get_proposals` accept unbounded `limit` — gas-DoS vector.**
All three contracts paginate with `for i in offset..end` where `end = (offset + limit).min(count)`. A caller can pass `limit = u32::MAX` and `offset = 0` — the loop iterates up to `count` entries. With large histories this is a predictable gas-exhaustion / archive-read DoS. Also `offset + limit` can overflow `u32` (panics in debug; wraps in release).
**Fix:** Clamp: `let limit = limit.min(100);` and `let end = offset.saturating_add(limit).min(count);`.

**M2. All contract read functions call `extend_ttl()` — every public read pays for a TTL bump.**
`balance()`, `get_revenue()`, `get_usage()`, `is_payment_used()`, etc. all invoke `extend_ttl`. That's correct for _writes_, but read-only calls from arbitrary callers can bump the instance TTL (and pay the fee) — and, worse, a frequently-called read keeps the contract alive forever even if abandoned. Reads should not extend TTL.
**Fix:** Keep `extend_ttl` only in mutating functions (`deposit`, `withdraw`, `charge`, `refund`, `set_*`, `record_payment`, `propose`, `approve`, `set_signers`).

**M3. Escrow accounting edge: `refund()` after `charge()` can leave `REVENUE` inconsistent with the token balance.**
Trace: deposit 500 → contract holds 500, user balance 500. `charge(user, 200)` → user balance 300, REVENUE 200 (tokens still in contract). `refund(user, 300)` → user balance 0, contract transfers 300 out (holds 200), REVENUE still 200. Now `withdraw_revenue(200)` transfers the last 200 — consistent _only because_ refund was ≤ the user's uncharged balance. But `refund` doesn't check that `amount ≤ REVENUE` available, and nothing tracks that refunds must come from the _chargeable_ portion. The test suite covers the happy path, but there's no invariant test asserting `contract_token_balance == Σbalances + revenue + Σrefunded` at every step.
**Fix:** Add an invariant/accounting test that walks deposit→charge→refund→withdraw_revenue sequences and asserts the token balance equation holds; consider tracking refunds in REVENUE (refund reduces revenue when it returns charged funds).

**M4. No limit on `payoutWalletAddress`/provider wallet reuse; payments route solely by `walletAddress` ownership.**
Provider ownership = `walletAddress` (the authenticated wallet). Anyone who connects a wallet can create a provider; nothing validates that `payoutWalletAddress` differs from `walletAddress` or that the wallet has a funded/registered Stellar account. Route registration only requires the upstream URL to be a public IP — **any authenticated provider can point a route at `https://api.openai.com/v1/chat/completions` and resell OpenAI access through the gateway** (rate-limited to 10 unpaid/min, but confirmed payments get 10×). This is an inherent arbitrage vector of the design.
**Fix:** Document the trust model; add optional provider approval flow (`active` gating already exists but nothing verifies providers before `create`); validate `payoutWalletAddress` format server-side.

**M5. `X-Payment-Receipt` header for streaming requests is never set.**
Non-streaming responses get `X-Payment-Receipt`; `handleStreamingForward` sets only `X-Request-Trace-Id` and never the receipt. The SDK's `callStream` parses the receipt from headers (`parseReceiptHeader`) and returns `cost` — for streams it will be `undefined` even though the SDK reports `success: true`. SDK/gateway contract mismatch.
**Fix:** In `handleStreamingForward`, set `X-Payment-Receipt` (and `X-Actual-Cost`/`X-Surplus` headers after `onDone` if not already flushed).

**M6. Webhook URL SSRF guard rejects IPv6 correctly but the _upstream_ guard has a DNS-rebinding TOCTOU.**
`validateUpstreamUrl` resolves at config time only; `proxy.service` re-fetches the URL at request time without re-validating the resolved IP. A provider who controls a domain's DNS (or an attacker who compromises the zone) can rebind it to `169.254.169.254` (cloud metadata) _after_ config passes. The webhook path re-validates at delivery (`validateWebhookUrl` at send time) — good — but the upstream path does not.
**Fix:** Re-validate the resolved address inside the fetch path (cache a 60s DNS allowlist keyed by hostname), or pin the validated IP in the URL during config.

**M7. Rate limiter identifies by IP only and defaults `TRUST_PROXY=1`.**
With `trust proxy = 1`, `request.ip` takes the left-most untrusted hop's `X-Forwarded-For`. In practice: if the gateway is directly exposed without a proxy, a client can spoof `X-Forwarded-For` and rotate IPs to bypass both unpaid and paid tiers. Config default `TRUST_PROXY=1` is safe _behind a proxy_ but dangerous when directly exposed (local dev, some Railway configs).
**Fix:** Require an explicit `TRUST_PROXY` decision; document that `0` must be used when directly exposed, and consider an optional wallet-address rate-limit dimension for paid tiers.

**M8. `payments.controller.ts` `getStatus` leaks whether a quote ID exists (enumeration).**
`GET /payments/:quoteId/status` returns `status: 'not_found'` vs. payment data with no auth and no rate-limit guard at the controller (the global `RateLimitGuard` isn't applied to `PaymentsController`). It's low-sensitivity data (payment status), but combined with the fact that quote IDs are unguessable UUIDs, enumeration is not practical. Still, the inconsistent protection surface (some controllers guarded, some not) is a smell.
**Fix:** Add `@UseGuards(RateLimitGuard)` to `PaymentsController` and consider returning a uniform 404.

**M9. `minPaymentAmount` config is defined but never enforced.**
`config.payment.minPaymentAmount` exists in `.env.example` and `loadConfig`, but neither quote generation nor verification uses it. For per-token routes, `requiredAmount` can fall back to **1 stroop** (`1n`) when the deposit computes to zero. So a route with `flatPrice=0` or degenerate per-token config would accept ~free access.
**Fix:** Enforce `minPaymentAmount` in `generateQuote` (reject or clamp quotes below it) and in `verifyStellarPayment` (reject amounts below it).

**M10. Email notifications are a logged placeholder; `EMAIL_ENABLED` config is inert.**
`EmailNotificationHandler.send()` just logs "In production, this would use nodemailer" and returns `true` — **and it's never registered** in the default dispatcher (only `inAppHandler` is). Config exposes `EMAIL_ENABLED`, `SMTP_HOST` etc. with no backend. Misleading config + dead code.
**Fix:** Wire nodemailer (or remove email config/docs until implemented); register an email handler conditionally on `EMAIL_ENABLED`.

### 🟡 Low / Hygiene

**L1. `Session` model and `ApiKey` model exist in Prisma but are unused** — `AuthStore` uses Redis for sessions; `Session`/`ApiKey` tables are dead schema.
**L2. `contracts/deployed-addresses.json` is untracked** (in git status as `??`) — yet DEPLOYMENT.md references deployed addresses; the file should be committed.
**L3. `scripts/build-contracts.sh` + `.prettierignore` + `apps/dashboard/.nvmrc` are untracked** — the monorepo is not fully committed; CI `quickstart-env` reads `.nvmrc` at root (exists, committed), but the dashboard `.nvmrc` is untracked.
**L4. No `CHANGELOG.md`, no git tags, no releases** — 13 commits, version pinned `0.1.0`, no release cadence (matters for Drips/GrantFox "active project" signals).
**L5. `@nestjs/websockets` + `socket.io` + `@socket.io/redis-adapter` dependencies installed but unused** in the gateway.
**L6. Lint warnings across dashboard (`webhooks/page.tsx` unused `Webhook`/`RefreshCw`), `hooks.ts` and SDK non-null assertions.**
**L7. `payments.service.confirmPayment` sets `route: ''` in the receipt** — cosmetic, but the receipt claims an empty route.
**L8. In-app notification queue is in-memory and unbounded per process** (capped at 1000, but lost on restart and not cross-instance).
**L9. Dashboard has no unit tests at all** (lint-only target; `project.json` for sdk has no `test` target either — SDK `index.ts` has no spec file).
**L10. `getTimeSeries` fetches all events in the window into memory** and buckets in JS — fine at small scale, unbounded at scale.
**L11. Health controller and admin health duplicate each other** (two `/health`-ish endpoints, one public one authed) — minor confusion.
**L12. The README badge claims "Stellar-Testnet" and the project is testnet-only** — no mainnet config tested; `deployed-addresses.json` has only `testnet`.

---

## ✅ 2. What's done well (genuinely)

- **Replay protection is triple-layered and race-safe**: Redis `SET NX` claim → on-chain `payment-verifier` `isPaymentUsedOnChain` → Postgres partial-unique single-use via `updateMany({ txHash: null })` + `@@unique([txHash])`. The `verifyAndConfirmPayment` cross-route replay rejection and quote-expiry enforcement show real security thinking.
- **SSRF guards are actually implemented** (webhooks + upstream URLs, DNS-resolved, private/link-local/CGNAT/metadata ranges rejected) with delivery-time re-validation for webhooks.
- **Contracts are well-tested** (34 escrow tests incl. auth-required, TTL survival, idempotency, revenue accounting, rotation quorum tests in multisig). Idempotency guards on `charge`/`refund` per `(user, quote_id)` are correct and tested. TTL extension is a real, current Soroban best practice.
- **CI is genuinely comprehensive**: lint, unit (with coverage thresholds), e2e (self-contained, mocked providers), contracts (`cargo test` per contract), `pnpm audit`, `.env` quickstart verification, Husky pre-push running lint+unit+e2e. Conventional-commits enforced.
- **Multi-tenant isolation is enforced at the query level** (payments/routes/providers/analytics/audit all scoped by `walletAddress`), with 404-vs-403 anti-probing choices documented.
- **Docs are strong**: README architecture + flow diagrams, DEPLOYMENT.md, SECURITY.md with a production checklist, CONTRIBUTING, CODEOWNERS, issue/PR templates.
- **Validation is centralized** in `@x402/validation` (zod) and applied at every boundary; config fail-fast rejects insecure JWT placeholders.

---

## 📊 3. Rating vs. Professional Open-Source Web3/Stellar Standards

Scored on a 5-point scale against the criteria typical of SDF ecosystem reviews (SCF / Drips / GrantFox):

| Criteria                        | Score | Notes                                                                                                                                           |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code quality & architecture** | 4.5/5 | Clean monorepo, typed, DRY packages, sensible module boundaries                                                                                 |
| **Security posture**            | 4.0/5 | Replay protection, SSRF guards, auth, rate limiting all real; gaps: unbounded pagination, DNS rebinding TOCTOU on upstreams, dev-mode surface   |
| **Smart contract safety**       | 4.0/5 | Auth checks, idempotency, TTL mgmt, overflow-checks on; missing: read-call TTL bumps, unbounded `limit`, formal/invariant tests, external audit |
| **Test coverage**               | 4.0/5 | 226 TS tests + 34 Rust tests green; but dashboard = 0 tests, SDK = 0 tests, e2e coverage thresholds low (55% stmts / 22% branches)              |
| **Documentation**               | 4.5/5 | Excellent README/DEPLOYMENT/SECURITY; missing CHANGELOG/releases                                                                                |
| **CI/CD maturity**              | 4.0/5 | Excellent CI; deploy pipeline broken (H1: no init, no address persistence); no mainnet pipeline                                                 |
| **Product completeness**        | 3.0/5 | Escrow settlement unwired (H3), external signer broken (H4), email inert (M10), SDK/gateway receipt mismatch (M5)                               |
| **Community/repo hygiene**      | 3.5/5 | Templates + CODEOWNERS + husky great; no tags/releases/CHANGELOG, untracked files, no good-first-issue labels yet                               |

**Overall: 3.9 / 5 — a strong, security-conscious, genuinely buildable project, held back from "exemplary" by unfinished feature wiring (escrow settlement, external signer, email) and release-process gaps.**

---

## 🌊 4. Verdict: Stellar Drips Wave 8 & Grantfox Eligibility

Verified against the live Drips network and Grantfox portals:

- **Stellar Wave (Drips)** is a **monthly 7-day contribution cycle**: Wave 7 ran **Jul 23–30, 2026** ($75,000 budget). As of Aug 11, 2026 the portal shows _"no active or upcoming Waves at the moment"_ — **Wave 8 has not yet been announced** (Waves have launched ~monthly since Jan 2026, so an August Wave 8 is plausible/expected). Participation is per-repo: **maintainers register public repos**, contributors fix tagged issues and earn points → XLM.
- **GrantFox** is a Stellar escrow-based **bounty/payout platform** (built on Trustless Work) where projects list GitHub issues as bounties with transparent, escrowed rewards — participation is per-campaign.

**Would this project be approved if submitted? — Yes, with caveats.**

✅ **Why it would be approved:** The Stellar Wave program and GrantFox approve _genuine, active, well-engineered Stellar open-source repos with well-scoped issues_. This repo clears the bar on every hard criterion: it builds, all tests pass, CI is green, it has real Soroban contracts deployed on testnet, real docs, a real license, contribution templates, and a security policy. Most Wave/GrantFox repos are far less mature.

⚠️ **What could delay or complicate approval:**

1. **No open issues / no labeled issues yet** — both programs require _curated, self-contained issues_ (e.g., `good first issue`, `Stellar Wave`, `GrantFox` labels) with acceptance criteria. The repo currently has zero tracked issues to assign.
2. **Testnet-only + no releases/tags** — "live and active" signals are stronger with a mainnet deployment and a tagged release.
3. **H1 is visible from the repo**: a deploy workflow that deploys uninitialized contracts could be flagged in review.
4. **Naming**: the "x402" brand is now governed by the **Linux Foundation's x402 Foundation** (launched July 14, 2026 — Coinbase, SDF, Stripe, Visa, etc. are members). Using "x402" as a project name may collide with the official protocol's branding; reviewers may ask you to rename (e.g., "PayGate" / "StellarPay") or to actually implement the **real x402 spec** (`x402.org` headers/signature scheme) rather than the project's own 402 flow.

**Bottom line:** On engineering merit alone, this project **would be approved** for both the Stellar Wave (Drips) repo registry and GrantFox bounties — it is exactly the kind of project those programs exist for. To maximize approval odds for a Wave 8 / GrantFox submission, fix the 🔴 items (esp. H1 and H3), publish 5–10 well-scoped tagged issues with acceptance criteria, and cut a `v0.1.0` release.

---

## 🛠 5. Recommended Fix Order

1. **Fix the deploy pipeline** (H1): init contracts after deploy + persist addresses.
2. **Wire escrow settlement or remove the flag** (H3) — biggest credibility gap vs. docs.
3. **Implement SDK external signer** (H4) and **streaming receipt header** (M5).
4. **Harden contracts** (M1, M2) — clamp limits, TTL only on writes.
5. **Enforce `minPaymentAmount`** (M9), **re-validate upstream DNS at proxy time** (M6), **clarify TRUST_PROXY** (M7).
6. **Remove or implement email notifications** (M10).
7. **Repo hygiene**: commit untracked files, add CHANGELOG + tag `v0.1.0`, add dashboard/SDK tests, fix lint warnings, curate labeled issues for Wave/Grantfox.
8. Consider a **third-party contract audit** (e.g., via SDF ecosystem auditors) before mainnet — standard expectation for production Soroban projects holding real funds.

---

_Generated by automated codebase audit — August 11, 2026._
