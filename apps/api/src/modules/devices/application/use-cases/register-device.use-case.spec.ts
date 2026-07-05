import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException } from '@nestjs/common'
import { RegisterDeviceUseCase } from './register-device.use-case'

const mockRepo = { findByExternalId: vi.fn(), create: vi.fn() }

describe('RegisterDeviceUseCase', () => {
  const useCase = new RegisterDeviceUseCase(mockRepo as any)

  beforeEach(() => vi.clearAllMocks())

  it('registers a new device', async () => {
    mockRepo.findByExternalId.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1' })
    const result = await useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })
    expect(result.id).toBe('d1')
    expect(mockRepo.create).toHaveBeenCalledWith({ externalId: 'device-1', name: 'Sensor 1' })
  })

  it('throws ConflictException when externalId already exists', async () => {
    mockRepo.findByExternalId.mockResolvedValue({ id: 'd1' })
    await expect(useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })).rejects.toThrow(ConflictException)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })
})
