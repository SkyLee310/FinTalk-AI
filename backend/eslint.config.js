import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript's own checker resolves globals and module bindings, so
      // ESLint's no-undef only yields false positives on .ts files.
      'no-undef': 'off',
    },
  },
);
