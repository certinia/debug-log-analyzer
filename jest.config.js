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
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};
/** @type {import('@jest/types').Config.InitialOptions} */
export default {
  projects: [
    {
      ...defaultConfig,
      displayName: 'log-viewer',
      rootDir: '<rootDir>/log-viewer',
      transformIgnorePatterns: [ 
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
      testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/out/'],
    },
    {
      ...defaultConfig,
      displayName: 'modules',
      rootDir: '<rootDir>/modules',
      testPathIgnorePatterns: ['<rootDir>/node_modules/'],
    },
  ],
};
