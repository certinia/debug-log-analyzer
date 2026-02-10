const defaultConfig = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(ts|js)?$': [
      '@swc/jest',
      {
        jsc: {
          target: 'esnext',
          parser: { decorators: true, syntax: 'typescript' },
        },
      },
    ],
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/out/'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};

/** @type {import('@jest/types').Config.InitialOptions} */
export default {
  projects: [
    {
      ...defaultConfig,
      displayName: 'apex-log-parser',
      rootDir: '<rootDir>/apex-log-parser',
    },
    {
      ...defaultConfig,
      displayName: 'log-viewer',
      rootDir: '<rootDir>/log-viewer',
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^apex-log-parser$': '<rootDir>/../apex-log-parser/src/index.ts',
      },
      transformIgnorePatterns: [
        // allow transformation of pixi.js and its dependencies
        '<rootDir>/node_modules/(?!pixi\\.js)',
      ],
    },
    {
      ...defaultConfig,
      displayName: 'lana',
      rootDir: '<rootDir>/lana',
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^vscode$': '<rootDir>/src/__tests__/mocks/vscode.ts',
        '^apex-log-parser$': '<rootDir>/../apex-log-parser/src/index.ts',
      },
      transformIgnorePatterns: [
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
    },
  ],
  slowTestThreshold: 1,
};
