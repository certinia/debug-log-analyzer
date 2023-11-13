module.exports = {
  projects: [
    {
      displayName: 'log-viewer',
      rootDir: '<rootDir>/log-viewer',
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
      transformIgnorePatterns: [
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
      testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/out/'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
    },
  ],
};
