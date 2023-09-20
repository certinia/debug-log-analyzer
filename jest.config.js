module.exports = {
  projects: [
    {
      displayName: 'log-viewer',
      rootDir: '<rootDir>/log-viewer',
      testEnvironment: 'node',
      transform: {
        // transform files with ts-jest
        '^.+\\.(ts|js)?$': '@swc/jest',
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
