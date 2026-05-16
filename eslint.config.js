import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'] },

  // TypeScript recommended — applies to *.ts, *.tsx by default
  ...tseslint.configs.recommended,

  // Node globals for api + shared
  {
    files: ['api/src/**/*.ts', 'shared/src/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Browser globals for web TS files
  {
    files: ['web/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  // Shared TS rules across all packages
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },

  // Drizzle layer enforcement — api source files only, excluding allowed files
  {
    files: ['api/src/**/*.ts'],
    ignores: ['api/src/**/repository.ts', 'api/src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message:
                'Drizzle may only be imported in repository.ts and db/ files (ARCHITECTURE.md §2).',
            },
          ],
        },
      ],
    },
  },

  // Vue 3 SFCs — manual flat config (pluginVue flat/* keys not available in this version)
  {
    files: ['**/*.vue'],
    plugins: { vue: pluginVue },
    processor: pluginVue.processors['.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
      globals: globals.browser,
    },
    rules: {
      // Pull rules from the legacy recommended config object
      ...pluginVue.configs['vue3-recommended'].rules,
      // Enforce <script setup lang="ts"> on every SFC (CLAUDE.md §5)
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/script-setup-uses-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
