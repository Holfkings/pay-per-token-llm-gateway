import type { Config } from 'jest';

const config: Config = {
  displayName: 'gateway',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Pin NODE_ENV=test + a throwaway JWT_SECRET (see file) so the H3
  // config fail-fast hardening doesn't block test runs.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  coverageDirectory: '../../coverage/apps/gateway',
  testPathIgnorePatterns: ['/e2e/'],
  // coverageReporters is configured via the nx executor options (global config).
  // Ratcheted to 70%: unit tests now cover payments, proxy and analytics
  // services (98% stmts / 93% branches overall). Ratchet up over time.
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
};

export default config;
