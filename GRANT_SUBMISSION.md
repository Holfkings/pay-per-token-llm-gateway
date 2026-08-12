# 🏆 x402 LLM Gateway — Grant Submission Issue Summary

> Curated issue set for **Stellar Wave (Drips)** & **GrantFox** submission — August 2026.
> All 18 curated issues carry the `Stellar Wave` · `GrantFox OSS` · `Maybe Rewarded` · `bounty` labels.
> Data reflects the **live GitHub issue state** (labels, status, and points pulled from the actual repo).

---

## 📊 At a Glance

| Metric                       | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| Curated issues               | **18** (10 original Wave-8 + 8 hardening/feature batch)     |
| Open (up for grabs)          | **14**                                                      |
| Implemented & closed         | **4** ✅                                                    |
| Areas covered                | contracts, gateway, SDK, dashboard, notifications, database |
| `good first issue` count     | **6**                                                       |
| `security`-labeled count     | **4**                                                       |
| Total points (open + closed) | **2,700**                                                   |
| Total points (open only)     | **2,100**                                                   |

**Point model:** High = 200 · Medium = 150 · Trivial = 100

---

## 📁 Grouped by Area

### 🧱 Soroban Smart Contracts (Rust)

| #   | Issue                                             | GitHub                                                                                  | Difficulty | Status    | Pts |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | --------- | --- |
| 1   | Wire credit-escrow settlement for metered pricing | [#25](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/25) | High       | open      | 200 |
| 11  | Multisig payout automation                        | [#40](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/40) | High       | open      | 200 |
| 3   | Clamp unbounded pagination limits (gas DoS)       | [#27](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/27) | Medium     | open      | 150 |
| 4   | Remove `extend_ttl` from read-only functions      | [#28](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/28) | Medium     | open      | 150 |
| 10  | Escrow accounting invariant tests                 | [#34](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/34) | Medium     | ✅ closed | 150 |

### 🚪 Gateway (NestJS)

| #   | Issue                                               | GitHub                                                                                  | Difficulty | Status    | Pts |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | --------- | --- |
| 12  | Explicit `TRUST_PROXY` + wallet-based rate limiting | [#41](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/41) | Medium     | open      | 150 |
| 13  | Validate payout wallets + provider approval flow    | [#42](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/42) | Medium     | open      | 150 |
| 15  | SQL time-series bucketing                           | [#44](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/44) | Medium     | open      | 150 |
| 5   | Streaming (SSE) payment-receipt headers             | [#29](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/29) | Medium     | open      | 150 |
| 7   | Enforce `minPaymentAmount`                          | [#31](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/31) | Trivial    | open      | 100 |
| 17  | Populate route in payment receipts                  | [#46](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/46) | Trivial    | open      | 100 |
| 18  | Remove unused `Session`/`ApiKey` Prisma models      | [#47](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/47) | Trivial    | open      | 100 |
| 6   | DNS rebinding protection at proxy time              | [#30](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/30) | Medium     | ✅ closed | 150 |

### 🔌 Client SDK (TypeScript)

| #   | Issue                                        | GitHub                                                                                  | Difficulty | Status | Pts |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ------ | --- |
| 2   | SDK external signer (`signTransaction`) path | [#26](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/26) | High       | open   | 200 |
| 16  | SDK unit tests                               | [#45](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/45) | Medium     | open   | 150 |

### 📊 Dashboard (Next.js)

| #   | Issue                                          | GitHub                                                                                  | Difficulty | Status    | Pts |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | --------- | --- |
| 8   | Jest unit tests for dashboard pages/components | [#32](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/32) | Medium     | ✅ closed | 150 |

### 🔔 Notifications

| #   | Issue                                    | GitHub                                                                                  | Difficulty | Status    | Pts |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | --------- | --- |
| 14  | Persist in-app notifications in Postgres | [#43](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/43) | Medium     | open      | 150 |
| 9   | Email notification channel (nodemailer)  | [#33](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/33) | Medium     | ✅ closed | 150 |

---

## 🎯 Grouped by Difficulty

| Difficulty        | Open   | Closed | Issue numbers                                              | Points    |
| ----------------- | ------ | ------ | ---------------------------------------------------------- | --------- |
| **High** (200)    | 3      | 0      | #25, #26, #40                                              | 600       |
| **Medium** (150)  | 8      | 4      | #27, #28, #29, #30, #32, #33, #34, #41, #42, #43, #44, #45 | 1,800     |
| **Trivial** (100) | 3      | 0      | #31, #46, #47                                              | 300       |
| **Total**         | **14** | **4**  | —                                                          | **2,700** |

### 🌱 Quick wins (`good first issue`) — great onboarding entry points

| Issue                                          | GitHub                                                                                  | Pts |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | --- |
| Enforce `minPaymentAmount`                     | [#31](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/31) | 100 |
| Populate route in payment receipts             | [#46](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/46) | 100 |
| Remove unused `Session`/`ApiKey` Prisma models | [#47](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/47) | 100 |
| SQL time-series bucketing (Medium)             | [#44](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/44) | 150 |
| SDK unit tests (Medium)                        | [#45](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/45) | 150 |
| Dashboard unit tests (Medium, closed)          | [#32](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/32) | 150 |

### 🔒 Security-hardening cluster (attracts senior reviewers)

| Issue                                               | GitHub                                                                                  | Pts |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- | --- |
| Explicit `TRUST_PROXY` + wallet-based rate limiting | [#41](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/41) | 150 |
| Validate payout wallets + provider approval flow    | [#42](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/42) | 150 |
| Clamp unbounded pagination limits (gas DoS)         | [#27](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/27) | 150 |
| DNS rebinding protection (closed)                   | [#30](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/30) | 150 |

---

## ✅ Implemented (closed) — proof of activity

| Issue                              | GitHub                                                                                  | Commit    |
| ---------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| DNS rebinding protection           | [#30](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/30) | `813fed7` |
| Dashboard unit tests (scaffolding) | [#32](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/32) | `05e10c9` |
| Email notification channel         | [#33](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/33) | `09e4706` |
| Escrow accounting invariant tests  | [#34](https://github.com/Pay-Per-Token-LLM-Gateway/pay-per-token-llm-gateway/issues/34) | `b49a2d1` |

---

## 📦 Point Allocation Summary

| Bucket            | Points    |
| ----------------- | --------- |
| High (3 × 200)    | 600       |
| Medium (12 × 150) | 1,800     |
| Trivial (3 × 100) | 300       |
| **Total**         | **2,700** |
| — open only       | **2,100** |

---

## 🔎 Notes for Reviewers

- **Areas with full coverage:** Soroban contracts (5 issues), gateway (8 issues), SDK (2), dashboard (1), notifications (2).
- **Bounty-ready:** every issue carries `bounty` for the Drips/Wave point ledger and is eligible for `Maybe Rewarded` GrantFox payouts on merge.
- **Maturity signal:** 4 of 18 issues already implemented and closed by the maintainer in the same week the set was curated — the repo is actively maintained, not a parked codebase.
- **Escrow settlement (#25)** remains open as the flagship feature: the highest-value integration for real usage on Stellar testnet/mainnet.
- **Onboarding funnel:** 6 `good first issue` tags (3 trivial + 3 medium) give newcomers a clear entry point while the 3 High issues give experienced contributors meaningful scope.

---

_Generated August 11, 2026 · Live issue state via GitHub API · See [.github/WAVE8_ISSUES.md](.github/WAVE8_ISSUES.md) for full issue bodies._
