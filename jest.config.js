/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    {
      displayName: 'log-viewer',
      moduleNameMapper: {
        '^.+\\.(css|less)$': '<rootDir>/resources/css/stub.js',
      },
      rootDir: '<rootDir>/log-viewer',
      testEnvironment: 'node',
      preset: 'ts-jest',
      transform: {
        // transform files with ts-jest
        '^.+\\.(ts|js)?$': [
          'ts-jest',
          {
            isolatedModules: true,
            tsconfig: {
              // allow js in typescript
              allowJs: true,
            },
          },
        ],
      },
      transformIgnorePatterns: [
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
      testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/out/'],
    },
  ],
};
