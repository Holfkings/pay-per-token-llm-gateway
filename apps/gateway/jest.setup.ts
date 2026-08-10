/**
 * Jest setup for gateway unit + e2e suites.
 *
 * `loadConfig()`/`validateEnv()` fail fast in every non-test environment when
 * JWT_SECRET is missing or a known placeholder (H3 hardening). Tests pin
 * NODE_ENV=test and provide a throwaway secret so the suites run deterministically
 * regardless of the shell environment.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'gateway-jest-test-secret';
