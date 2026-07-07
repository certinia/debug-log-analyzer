import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/.sf/',
    '**/.sfdx/',
    '**/dist/',
    '**/build/',
    '**/out/',
    '**/coverage/',
    '**/.docusaurus/',
    // only TypeScript is linted; without this, `eslint .` selects js/mjs/cjs
    // by default and scans them with no rules
    '**/*.js',
    '**/*.mjs',
    '**/*.cjs',
  ]),
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended, prettierConfig],

    rules: {
      'no-console': 'warn',
      '@typescript-eslint/naming-convention': [
        'warn',
        // options replace the rule's defaults, so the base selectors are restated
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // PascalCase consts: enum-like objects (TimelineErrorCode) and vscode API
        // mocks (Uri); allowSingleOrDouble covers __dirname
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
          trailingUnderscore: 'allow',
        },
        // UPPER_CASE static readonly class constants (MAX_CACHE_SIZE, DRAG_THRESHOLD)
        {
          selector: 'classProperty',
          modifiers: ['static', 'readonly'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        // object keys mirror external data: Salesforce API fields, Apex log
        // event/category names, module paths, ANTLR rule names
        { selector: ['objectLiteralProperty', 'objectLiteralMethod'], format: null },
        // quoted type keys, e.g. 'context-menu' in HTMLElementTagNameMap
        { selector: 'typeProperty', modifiers: ['requiresQuotes'], format: null },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          // inline `import('...').Foo` type annotations are already type-only;
          // they don't survive into bundler emit, so this rule focuses purely
          // on the statement-level "type imported as value" bug.
          disallowTypeAnnotations: false,
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      curly: 'warn',
      eqeqeq: 'warn',
    },
  },
);
