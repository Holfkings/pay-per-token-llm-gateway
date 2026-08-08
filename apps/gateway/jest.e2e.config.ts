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
  coverageDirectory: '../../coverage/apps/gateway-e2e',
};

export default config;
