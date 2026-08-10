import type { Config } from 'jest';

const config: Config = {
  displayName: 'gateway-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['**/*.e2e-spec.ts'],
  // Pin NODE_ENV=test + a throwaway JWT_SECRET (see file) so the H3
  // config fail-fast hardening doesn't block test runs.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  coverageDirectory: '../../coverage/apps/gateway-e2e',
  // coverageReporters is configured via the nx executor options (global config).
  // Thresholds calibrated slightly below current coverage (67% stmts / 34%
  // branches) so CI stays green while enforcing a floor. Ratchet up over time.
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 25,
      functions: 35,
      lines: 55,
    },
  },
};

export default config;
