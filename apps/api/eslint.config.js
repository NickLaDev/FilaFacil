import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'src/generated', 'storage', 'coverage']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Sem consistent-type-imports: a injeção de dependência do Nest depende dos imports de classe em runtime.
    },
  },
  {
    // O seed é um script de linha de comando: imprime o resumo no terminal.
    files: ['prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
]);
