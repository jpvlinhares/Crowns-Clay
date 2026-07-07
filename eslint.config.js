// Dependency-direction enforcement per TDD §3. The tsconfig project references
// already make illegal imports fail to *build*; these lint rules make the intent
// explicit and catch dynamic/deep imports the compiler graph can miss.
// (Requires: npm i -D eslint @eslint/js typescript-eslint — see README bootstrap.)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const banned = (pkgs, message) => ({
  patterns: [{ group: pkgs.flatMap((p) => [`@crowns/${p}`, `@crowns/${p}/*`]), message }],
});

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  { ignores: ['**/dist/**'] },

  // underscore-prefixed parameters are the repo's "declared but unused" idiom
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // build/dev scripts run under Node
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },

  // sim is headless: no DOM, no render/ui/app, no Math.random (TDD §5 rule 1)
  {
    files: ['packages/sim/**/*.ts', 'packages/data/**/*.ts', 'packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', banned(['render', 'ui', 'app'], 'sim-side code must not import presentation packages (TDD §3)')],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'sim is headless (TDD §3)' },
        { name: 'document', message: 'sim is headless (TDD §3)' },
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'use @crowns/core Rng (TDD §5)' },
        { object: 'Date', property: 'now', message: 'no wall-clock in sim (TDD §5)' },
      ],
    },
  },

  // presentation never reaches into sim internals — protocol only
  {
    files: ['packages/render/**/*.ts', 'packages/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', banned(['sim', 'data'], 'presentation speaks only @crowns/protocol (TDD §3)')],
    },
  },

  // core depends on nothing
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', banned(['data', 'protocol', 'sim', 'render', 'ui', 'app', 'tools'], '@crowns/core has no internal dependencies (TDD §3)')],
    },
  },
);
