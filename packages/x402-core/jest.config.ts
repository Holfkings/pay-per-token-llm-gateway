import type { Config } from 'jest';

const config: Config = {
  displayName: 'x402-core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/x402-core',
  // coverageReporters is configured via the nx executor options (global config).
  // Thresholds calibrated slightly below current coverage (97% stmts / 79%
  // branches) so CI stays green while enforcing a floor. Ratchet up over time.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 70,
      functions: 85,
      lines: 90,
    },
  },
};

export default config;
