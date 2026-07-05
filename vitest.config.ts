import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts'],
    globals: true,
  },
  plugins: [swc.vite()],
})
