import love from 'eslint-config-love'
import prettier from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import'
import { fileURLToPath } from 'node:url'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default [
  {
    ignores: ['dist/**', '.yarn/**', 'node_modules/**', 'coverage/**', '.prettierrc.cjs'],
  },
  {
    ...love,
    files: ['**/*.{ts,mjs,cjs}'],
  },
  {
    files: ['**/*.{ts,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      'import/first': 'error',
      'import/no-duplicates': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/init-declarations': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@eslint-community/eslint-comments/require-description': 'off',
      'arrow-body-style': 'off',
      'no-console': 'off',
      'prefer-named-capture-group': 'off',
      'require-unicode-regexp': 'off',
      'no-negated-condition': 'off',
      '@typescript-eslint/strict-void-return': 'off',
      // Fakes satisfy async ports without awaiting anything.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      complexity: ['error', 10],
      '@typescript-eslint/max-params': ['error', { max: 4 }],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'max-lines': ['error', 250],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines': 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Vitest's asymmetric matchers are typed `any`.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  prettier,
]
