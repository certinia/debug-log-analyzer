import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    pool: 'vmThreads',
    // CI always starts cold, so writing the cache there only costs time.
    fsModuleCache: !process.env.CI,
    slowTestThreshold: 1000,
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    projects: [
      {
        extends: true,
        root: here('./log-viewer'),
        resolve: {
          alias: [
            {
              find: /^#test-helpers\/(.*)\.js$/,
              replacement: here('./log-viewer/src/__tests__/helpers/$1.ts'),
            },
            // `VsSelect.ts` extends the real `vscode-single-select`; an empty module breaks it at load.
            {
              find: /^#vscode-elements\/(?!vscode-single-select\.js$).*$/,
              replacement: here('./log-viewer/src/__tests__/mocks/emptyModule.ts'),
            },
            {
              find: /^tabulator-tables$/,
              replacement: here('./log-viewer/src/tabulator/module/__mocks__/tabulator-tables.ts'),
            },
            // One bundle, not the ~720-module `import` entry; the path must track pixi's `dist/`.
            {
              find: /^pixi\.js$/,
              replacement: here('./log-viewer/node_modules/pixi.js/dist/pixi.mjs'),
            },
          ],
        },
        test: { name: 'log-viewer' },
      },
      {
        extends: true,
        root: here('./lana'),
        resolve: {
          alias: [{ find: /^vscode$/, replacement: here('./lana/src/__tests__/mocks/vscode.ts') }],
        },
        test: { name: 'lana' },
      },
    ],
  },
});
