import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/**/*.integration.spec.ts'],
    globals: true,
    testTimeout: 30000,
  },
})
