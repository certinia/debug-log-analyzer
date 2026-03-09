import { defineConfig, Plugin } from 'rolldown';

// rolldown plugins
import nodePolyfills from '@rolldown/plugin-node-polyfills';

// rollup plugins
import copy from 'rollup-plugin-copy';
import postcss from 'rollup-plugin-postcss';
import { defineRollupSwcOption, swc } from 'rollup-plugin-swc3';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getSwcOptions = (dirPath: string) =>
  defineRollupSwcOption({
    include: /\.[mc]?[jt]sx?$/,
    exclude: 'node_modules',
    tsconfig: production ? `${dirPath}/tsconfig.json` : `${dirPath}/tsconfig-dev.json`,
    jsc: {
      transform: { useDefineForClassFields: false },
      minify: {
        compress: production ? { keep_classnames: true, keep_fnames: true } : false,
        mangle: production ? { keep_classnames: true } : false,
      },
    },
  });

/**
 * Workaround for oxc printer lone-surrogate bug (https://github.com/oxc-project/oxc/issues/3526).
 * The oxc codegen replaces lone surrogates (0xD800-0xDFFF) with U+FFFD in long CJS strings,
 * corrupting ANTLR ATN serialized data which uses surrogates as raw char codes.
 * This plugin converts the string literals to numeric char code arrays before the printer
 * sees them. Can be removed once the upstream fix fully covers CJS long strings.
 */
/**
 * Stubs @apexdevtools/apex-parser Check.js for browser builds.
 * Check.js imports node:fs, node:path etc. for filesystem operations that are
 * never used in the browser. Replace the module with an empty export.
 */
function stubApexParserCheck(): Plugin {
  return {
    name: 'stub-apex-parser-check',
    load(id) {
      if (id.includes('@apexdevtools/apex-parser') && id.endsWith('/Check.js')) {
        return 'export {}';
      }
    },
  };
}

function preserveAntlrATN(): Plugin {
  const segmentPattern =
    /(\w+\._serializedATNSegment\d+)\s*=\s*("(?:[^"\\]|\\.)*"(?:\s*\+\s*"(?:[^"\\]|\\.)*")*)\s*;/g;

  return {
    name: 'preserve-antlr-atn',
    transform(code, id) {
      if (!id.includes('node_modules') || !/_serializedATNSegment\d+\s*=/.test(code)) {
        return;
      }

      return code.replace(segmentPattern, (_match, varName: string, expr: string) => {
        const str = new Function(`return ${expr}`)() as string;
        const charCodes = Array.from(str, (c) => c.charCodeAt(0));
        return `${varName} = String.fromCharCode(${charCodes.join(',')});`;
      });
    },
  };
}

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
      keepNames: true,
    },
    tsconfig: production ? './lana/tsconfig.json' : './lana/tsconfig-dev.json',
    platform: 'node',
    resolve: {
      alias: {
        'apex-log-parser': path.resolve(__dirname, 'apex-log-parser/src/index.ts'),
      },
    },

    external: ['vscode'],
    plugins: [preserveAntlrATN(), swc(getSwcOptions('./lana'))],
  },
  {
    input: { bundle: './log-viewer/src/Main.ts' },
    output: [
      {
        format: 'esm',
        dir: './log-viewer/out',
        chunkFileNames: 'log-viewer-[name].js',
        sourcemap: false,
        keepNames: true,
      },
    ],
    platform: 'browser',
    resolve: {
      alias: {
        eventemitter3: path.resolve(__dirname, 'node_modules/eventemitter3/index.js'),
      },
    },
    moduleTypes: {
      '.css': 'js',
    },
    tsconfig: production ? './log-viewer/tsconfig.json' : './log-viewer/tsconfig-dev.json',
    plugins: [
      stubApexParserCheck(),
      nodePolyfills(),
      postcss({
        extensions: ['.css', '.scss'],
        minimize: true,
      }),
      swc(getSwcOptions('./log-viewer')),
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
