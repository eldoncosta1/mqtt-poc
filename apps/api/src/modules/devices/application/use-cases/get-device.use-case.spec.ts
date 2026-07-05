import { describe, it, expect, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { GetDeviceUseCase } from './get-device.use-case'

describe('GetDeviceUseCase', () => {
  it('returns the device when found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: 'd1' }) }
    const useCase = new GetDeviceUseCase(mockRepo as any)
    const result = await useCase.execute('d1')
    expect(result.id).toBe('d1')
  })

  it('throws NotFoundException when device does not exist', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(null) }
    const useCase = new GetDeviceUseCase(mockRepo as any)
    await expect(useCase.execute('unknown')).rejects.toThrow(NotFoundException)
  })
})
