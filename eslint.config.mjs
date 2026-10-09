import pluginJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-duplicate-imports': ['error', { includeExports: true }],
      'no-trailing-spaces': 'error',
      quotes: ['error', 'single', { avoidEscape: true }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // REST route safety. These selectors are a HINT for reviewers, not the guarantee: static
    // analysis cannot follow every alias (e.g. an axios instance passed to a helper). The real
    // guard is runtime: `createGuardedZodios` installs a path-param plugin plus an axios request
    // interceptor (`assertSafeRequestUrl`) on every client, which checks the final URL axios sends.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Zodios']",
          message:
            'Construct Zodios clients with createGuardedZodios(...) from src/sdks/routeSafety/zodios.ts (route-traversal guard).',
        },
        {
          // Raw calls on a Zodios client's axios instance: the URL must be a direct
          // `buildRestPath(...)` call (validated, individually encoded segments).
          selector:
            "CallExpression[callee.object.property.name='axios'][callee.property.name=/^(get|post|put|patch|delete|head|options)$/]:not([arguments.0.type='CallExpression'][arguments.0.callee.name='buildRestPath'])",
          message:
            'Pass buildRestPath(...) directly as the URL of a raw axios call (route-traversal guard).',
        },
        {
          selector:
            "CallExpression[callee.property.name='axios'], CallExpression[callee.object.property.name='axios'][callee.property.name='request']",
          message:
            'Use client.axios.<verb>(buildRestPath(...), ...) instead of a config-object axios request (route-traversal guard).',
        },
        {
          selector:
            "VariableDeclarator[init.property.name='axios'], VariableDeclarator > ObjectPattern > Property[key.name='axios']",
          message:
            "Do not alias a client's axios instance; call client.axios.<verb>(buildRestPath(...)) so the URL stays lintable (route-traversal guard).",
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/web/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Standalone Node CLI scripts (plain JS): the TS return-type rule is
    // inapplicable to .mjs, and a CLI legitimately writes to stdout.
    files: ['docs/scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // Custom-provider test fixtures loaded via require(): plain JS, so the
    // TS return-type rule is inapplicable.
    files: ['src/sessionStore/__fixtures__/**/*.cjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'docs/.docusaurus/**',
      'docs/build/**',
      '.claude/**',
      '.worktrees/**',
      'src/templates/**',
    ],
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
  },
];
