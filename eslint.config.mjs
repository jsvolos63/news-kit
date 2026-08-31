// ESLint flat config. Goal: catch shadows / unused vars / undefined
// references going forward without forcing a sweeping style cleanup — CI
// should flag real bugs, not stylistic preferences.
//
// This kit is the family's widest-blast-radius code: one bug here reaches
// every consumer's vendored copy on their next pin bump, and consumers
// commit that copy as bundler output nobody reads line by line. It was also
// the last code in the family with no linter at all.
//
// index.js is dependency-free and runs in BOTH a browser (the river
// renderer, the modal plumbing, the sanitizers touch document/window) and
// Node (the RSS parsing and dedupe are used server-side by John's News), so
// it gets both global sets. It must never reference a Node-only builtin at
// module scope — `"sideEffects": false` depends on it, and the vendoring
// CLI tree-shakes narrowed builds on that promise.

import js from '@eslint/js';
import globals from 'globals';

const rules = {
  'no-shadow': 'error',
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_?$',
  }],
  'no-undef': 'error',
  'no-redeclare': 'error',
  // A deliberate best-effort swallow (localStorage in private mode, a
  // detached test window) is allowed, but must carry a comment saying why.
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-escape': 'off',
  'prefer-const': 'off',
  // OFF, deliberately. Stripping C0/C1 control characters out of URLs is
  // precisely what the guards here are FOR, so the rule fires on the
  // security code rather than on a mistake — and one of the two hits is
  // inside the generated `@jfs-sanitizer-policy:url-control-chars` region,
  // which may only be changed through `jfs-sanitizer-policy-sync`.
  'no-control-regex': 'off',
  // OFF, deliberately. The vendor suite matches a known two-space indent in
  // generated output; `/^  (\w+): /` is clearer there than `/^ {2}(\w+): /`.
  'no-regex-spaces': 'off',
};

export default [
  js.configs.recommended,
  {
    // The kit itself: browser-first, but also imported by Node consumers.
    files: ['index.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules,
  },
  {
    // The vendoring shim and the suite: Node ESM. The tests build DOM
    // fixtures, so they get the browser set too.
    files: ['bin/**/*.mjs', 'test/**/*.mjs', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules,
  },
  { ignores: ['node_modules/**'] },
];
