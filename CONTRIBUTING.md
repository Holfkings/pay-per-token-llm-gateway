# Contributing to x402 LLM Gateway

## Development Setup

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Copy environment: `cp .env.example .env`
4. Start infrastructure: `docker compose up -d postgres redis`
5. Push database schema: `pnpm nx run database:push`
6. Start dev servers: `pnpm dev:gateway` and `pnpm dev:dashboard`

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `refactor:` — Code refactoring
- `test:` — Tests
- `chore:` — Build/config changes
- `contracts:` — Soroban contract changes

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- NestJS modules follow single-responsibility
- Soroban contracts follow [Stellar best practices](https://developers.stellar.org/docs/smart-contracts)

## Testing

```bash
# All tests
pnpm test

# Specific package
pnpm exec nx test gateway
pnpm exec nx test sdk

# Contracts
cd contracts/payment-verifier && cargo test

# E2E (requires running gateway)
pnpm test:e2e
```

## Pull Requests

- Keep PRs focused and small
- Include tests for new features
- Update documentation for API changes
- Ensure CI passes (lint, test, build)
- Add audit log entries for security-sensitive changes
