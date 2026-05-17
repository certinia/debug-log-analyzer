import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['**/node_modules', '**/.sf', '**/.sfdx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      'no-console': 'warn',
      '@typescript-eslint/naming-convention': 'warn',
      semi: 'warn',

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
