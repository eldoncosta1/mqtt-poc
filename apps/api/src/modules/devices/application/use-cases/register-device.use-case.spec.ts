import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException } from '@nestjs/common'
import { RegisterDeviceUseCase } from './register-device.use-case'

const mockRepo = { findByExternalId: vi.fn(), create: vi.fn() }
const mockReader = { read: vi.fn() }
const mockUpdateStatus = { execute: vi.fn() }

describe('RegisterDeviceUseCase', () => {
  const useCase = new RegisterDeviceUseCase(mockRepo as any, mockReader as any, mockUpdateStatus as any)

  beforeEach(() => {
    vi.clearAllMocks()
    mockReader.read.mockResolvedValue(null) // por padrão: sem status retido
  })

  it('registers a new device', async () => {
    mockRepo.findByExternalId.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1', status: 'UNKNOWN' })
    const result = await useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })
    expect(result.id).toBe('d1')
    expect(mockRepo.create).toHaveBeenCalledWith({ externalId: 'device-1', name: 'Sensor 1' })
  })

  it('throws ConflictException when externalId already exists', async () => {
    mockRepo.findByExternalId.mockResolvedValue({ id: 'd1' })
    await expect(useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })).rejects.toThrow(ConflictException)
    expect(mockRepo.create).not.toHaveBeenCalled()
    expect(mockReader.read).not.toHaveBeenCalled()
  })

  it('reconciles a retained status: applies it and returns the updated device', async () => {
    mockRepo.findByExternalId.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1', status: 'UNKNOWN' })
    mockReader.read.mockResolvedValue({ status: 'online', timestamp: '2026-07-08T10:00:00.000Z' })
    mockUpdateStatus.execute.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1', status: 'ONLINE' })

    const result = await useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })

    expect(mockReader.read).toHaveBeenCalledWith('device-1')
    expect(mockUpdateStatus.execute).toHaveBeenCalledWith({
      externalId: 'device-1',
      status: 'online',
      timestamp: '2026-07-08T10:00:00.000Z',
    })
    expect(result.status).toBe('ONLINE')
  })

  it('returns the created device (UNKNOWN) when there is no retained status', async () => {
    mockRepo.findByExternalId.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1', status: 'UNKNOWN' })
    mockReader.read.mockResolvedValue(null)

    const result = await useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })

    expect(mockUpdateStatus.execute).not.toHaveBeenCalled()
    expect(result.status).toBe('UNKNOWN')
  })
})
