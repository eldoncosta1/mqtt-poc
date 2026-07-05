import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  test: {
    include: ['apps/**/*.integration.spec.ts'],
    globals: true,
    testTimeout: 30000,
  },
  plugins: [swc.vite()],
})
