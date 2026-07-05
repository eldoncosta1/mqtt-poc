import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts'],
    globals: true,
  },
})
