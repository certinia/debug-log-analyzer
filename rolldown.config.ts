import { defineConfig } from 'rolldown';

// Rollup plugins
import copy from 'rollup-plugin-copy';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import postcss from 'rollup-plugin-postcss';
import { defineRollupSwcOption, swc } from 'rollup-plugin-swc3';

const production = process.env.NODE_ENV === 'production';
console.log('Package mode:', production ? 'production' : 'development');
export default defineConfig([
  {
    input: './lana/src/Main.ts',
    output: {
      format: 'esm',
      dir: './lana/out',
      chunkFileNames: 'lana-[name].js',
      sourcemap: false,
    },
    platform: 'node',
    external: ['vscode'],
    resolve: { tsconfigFilename: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json' },
    plugins: [
      swc(
        defineRollupSwcOption({
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
          tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
          jsc: {
            minify: {
              compress: production,
              mangle: production
                ? {
                    keep_classnames: true,
                  }
                : false,
            },
          },
        }),
      ),
    ],
  },
  {
    input: { bundle: './log-viewer/modules/Main.ts' },
    output: [
      {
        format: 'esm',
        dir: './log-viewer/out',
        chunkFileNames: 'log-viewer-[name].js',
        sourcemap: false,
      },
    ],
    platform: 'browser',
    keepNames: true,
    resolve: {
      tsconfigFilename: production
        ? './log-viewer/tsconfig.json'
        : './log-viewer/tsconfig-dev.json',
    },
    transform: { typescript: {} },
    plugins: [
      nodePolyfills(),
      postcss({
        extensions: ['.css', '.scss'],
        minimize: true,
      }),
      swc(
        defineRollupSwcOption({
          // All options are optional
          include: /\.[mc]?[jt]sx?$/,
          exclude: 'node_modules',
          tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
          jsc: {
            transform: { useDefineForClassFields: false },
            minify: {
              compress: production,
              mangle: production
                ? {
                    keep_classnames: true,
                  }
                : false,
            },
          },
        }),
      ),
      copy({
        hook: 'closeBundle',
        targets: [
          {
            src: [
              'log-viewer/out/*',
              'log-viewer/index.html',
              'lana/certinia-icon-color.png',
              'node_modules/@vscode/codicons/dist/codicon.ttf',
            ],
            dest: 'lana/out',
          },
          { src: ['CHANGELOG.md', 'LICENSE.txt', 'README.md'], dest: 'lana' },
        ],
      }),
    ],
  },
]);
