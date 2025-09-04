/**
 * @param {string} displayName
 * @param {string} rootDir
 */
const defineProject = (displayName, rootDir) => ({
  displayName,
  rootDir,
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
});

const projectConfigs = [
  {
    displayName: 'log-viewer',
    rootDir: '<rootDir>/log-viewer',
  },
  {
    displayName: 'lana',
    rootDir: '<rootDir>/lana',
  },
];

/** @type {import('@jest/types').Config.InitialOptions} */
export default {
  projects: projectConfigs.map(({ displayName, rootDir }) => defineProject(displayName, rootDir)),
};
