import { describe, it, expect, vi } from 'vitest'
import { loadLocalEnv } from './env'

describe('loadLocalEnv', () => {
  it('loads the .env file when it exists', () => {
    const loadEnvFile = vi.fn()
    loadLocalEnv({ existsSync: () => true, loadEnvFile })
    expect(loadEnvFile).toHaveBeenCalledWith('.env')
  })

  it('does nothing when the .env file is absent', () => {
    const loadEnvFile = vi.fn()
    loadLocalEnv({ existsSync: () => false, loadEnvFile })
    expect(loadEnvFile).not.toHaveBeenCalled()
  })
})
