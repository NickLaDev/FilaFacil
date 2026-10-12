// ESLint (flat config) da suíte E2E. Reaproveita eslint/typescript-eslint instalados em apps/web.
// Uso (da raiz): pnpm e2e:lint
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../apps/web/package.json'));
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

export default tseslint.config(
  { ignores: ['.results/**', 'scripts/**'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // corpos de resposta da API são JSON dinâmico nos testes
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-control-regex': 'off', // remove cores ANSI do log da API
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
);
