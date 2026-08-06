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
    // Test-only helpers living in src/ (mocks, mock servers, fixtures, shared test
    // utilities) must never be imported from production code — they are excluded from
    // coverage and never shipped. Test files, the helpers themselves, and the vitest
    // setup file are exempt.
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.mock.ts', '**/mock*.ts', '**/*Fixtures.ts', 'src/testSetup.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.mock.js', '**/mock*.js', '**/*Fixtures.js', '**/testShared.js'],
              message:
                'Test-only helper — import it from a *.test.ts file (or another test helper), never from production code.',
            },
          ],
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
      // Migration snapshot workspace (local-only, git-excluded) — reference material
      // only, never built or shipped.
      '.a2td-snapshot/**',
      // Lockstep byte-identity files (lockstep.hashes.json): kept byte-identical
      // with a2td's lockstep-core, so local prettier drift must not be "fixed"
      // here — scripts/check-lockstep.mjs is the gate that matters for these.
      'src/desktop/binder/classify.ts',
      'src/desktop/templates/fieldReferenceRewriter.ts',
    ],
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
  },
];
