import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
  // next/core-web-vitals bundles the React, hooks and jsx-a11y rules at
  // versions matched to this Next release; next/typescript adds the TS rules.
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];
