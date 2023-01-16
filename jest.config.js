/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  projects: [
    {
      displayName: 'log-viewer',
      globals: {
        'ts-jest': {
          isolatedModules: true,
          tsconfig: {
            // allow js in typescript
            allowJs: true,
          },
        },
      },
      moduleNameMapper: {
        '^.+\\.(css|less)$': '<rootDir>/resources/css/stub.js',
      },
      rootDir: '<rootDir>/log-viewer',
      testEnvironment: 'node',
      preset: 'ts-jest',
      transform: {
        // transform files with ts-jest
        '^.+\\.(ts|js)?$': 'ts-jest',
      },
      transformIgnorePatterns: [
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
      testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/out/'],
    },
  ],
};
