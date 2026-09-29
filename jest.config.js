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
          // Match the bundles (and log-viewer/tsconfig.json): with `define`
          // semantics a class field initializer shadows Lit's reactive
          // accessor, so property assignments never trigger a re-render.
          transform: { useDefineForClassFields: false },
        },
      },
    ],
  },
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/out/',
    '<rootDir>/test/playwright/',
  ],
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
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^apex-log-parser$': '<rootDir>/../apex-log-parser/src/index.ts',
        // Stylesheet imports have no transform here; the `.js` rule above runs first, so the
        // `*.css.ts` style modules are unaffected.
        '\\.s?css$': '<rootDir>/src/__tests__/mocks/styleStub.ts',
        // jsdom's ElementInternals has no setFormValue, so a form-associated element fails on
        // its first update, and vscode-icon warns on every connect about the missing codicon
        // stylesheet. Every importer wants the side effect only. vscode-single-select is the
        // exception: VsSelect extends the class and reads its styles, so it must stay real.
        '^#vscode-elements/(?!vscode-single-select\\.js$)':
          '<rootDir>/src/__tests__/mocks/vscodeElementStub.ts',
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
