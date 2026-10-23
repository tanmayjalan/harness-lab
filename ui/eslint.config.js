// The page's code checker (npm run lint): mistakes, and React's rules for hooks (each effect lists what it
// uses). TypeScript 7 has no API ESLint can call yet, so typescript-eslint reads the code with TypeScript 6:
// the "typescript" package here is Microsoft's @typescript/typescript6, and `tsc` is still TypeScript 7
// (@typescript/native). Only the two classic hooks rules are on: version 7's React Compiler rules would ask
// for changes in how some effects behave, which is a decision of its own.
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // `const { hooks: _, ...rest } = e` leaves a property out on purpose
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
