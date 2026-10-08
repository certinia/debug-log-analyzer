const defaultConfig = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // The parser is ESM-only: its `exports` offers `import`, and jest's CJS runtime asks for
    // `require`. Naming the files steps past the exports gate for this package alone — widening
    // the export conditions pulls every other dependency's ESM build in with it. The cost is that
    // this path must track the parser's own `exports`.
    '^@apexdevtools/apex-log-parser$':
      '<rootDir>/node_modules/@apexdevtools/apex-log-parser/dist/index.js',
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
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};

/** @type {import('@jest/types').Config.InitialOptions} */
export default {
  projects: [
    {
      ...defaultConfig,
      displayName: 'log-viewer',
      rootDir: '<rootDir>/log-viewer',
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^#test-helpers/(.*)\\.js$': '<rootDir>/src/__tests__/helpers/$1',
        // Stylesheet imports have no transform here; the `.js` rule above runs first, so the
        // `*.css.ts` style modules are unaffected.
        '\\.s?css$': '<rootDir>/src/__tests__/mocks/styleStub.ts',
        // `vscode-single-select` is excluded because `components/VsSelect.ts` extends the real
        // class, and an empty module would make that `extends undefined` at load. A mapper
        // beats `jest.requireActual`, so no suite can ask for a real element back.
        '^#vscode-elements/(?!vscode-single-select\\.js$)':
          '<rootDir>/src/__tests__/mocks/emptyModule.ts',
        // One bundle, not the ~720-module `require` entry; the path must track pixi's `dist/`.
        '^pixi\\.js$': '<rootDir>/node_modules/pixi.js/dist/pixi.mjs',
      },
      transform: {
        ...defaultConfig.transform,
        '^.+\\.mjs$': defaultConfig.transform['^.+\\.(ts|js)?$'],
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
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^vscode$': '<rootDir>/src/__tests__/mocks/vscode.ts',
      },
      transformIgnorePatterns: [
        // allow lit/@lit transformation
        '<rootDir>/node_modules/(?!@?lit)',
      ],
    },
    {
      ...defaultConfig,
      displayName: 'docs',
      rootDir: '<rootDir>/lana-docs',
      testEnvironment: 'jsdom',
      testEnvironmentOptions: { url: 'http://localhost/debug-log-analyzer/demo/viewer.html' },
      testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/build/',
        '<rootDir>/.docusaurus/',
      ],
      setupFilesAfterEnv: [],
      moduleNameMapper: {
        ...defaultConfig.moduleNameMapper,
        '^@site/(.*)$': '<rootDir>/$1',
        '\\.css$': '<rootDir>/src/__tests__/styleStub.ts',
      },
      transform: {
        '^.+\\.(ts|tsx|js)$': [
          '@swc/jest',
          {
            jsc: {
              target: 'esnext',
              parser: { syntax: 'typescript', tsx: true },
              transform: { react: { runtime: 'automatic' } },
            },
          },
        ],
      },
    },
  ],
  slowTestThreshold: 1,
};
