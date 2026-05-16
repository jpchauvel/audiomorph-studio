import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsparser },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // Pragmatic: `any` is tracked as tech debt (warn) rather than blocking
      // CI. New code is reviewed; existing `any` migrates opportunistically.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow `_`-prefixed unused vars (idiomatic for intentional discards).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'warn',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-build/**',
      '**/out/**',
      '**/build/**',
    ],
  },
];
