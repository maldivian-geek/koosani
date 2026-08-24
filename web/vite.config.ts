import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import pkg from './package.json'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    // Release version shown in the sidebar footer — package.json version is
    // kept in lockstep with CHANGELOG releases (CLAUDE.md §3).
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
})
