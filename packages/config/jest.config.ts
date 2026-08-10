import type { Config } from 'jest';

const config: Config = {
  displayName: 'config',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/config',
  // coverageReporters is configured via the nx executor options (global config).
  // Thresholds calibrated slightly below current coverage (82% stmts / 95%
  // branches) so CI stays green while enforcing a floor. Ratchet up over time.
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 55,
      functions: 55,
      lines: 70,
    },
  },
};

export default config;
