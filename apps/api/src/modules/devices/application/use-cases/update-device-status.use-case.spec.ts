import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceStatus } from '@prisma/client'
import { UpdateDeviceStatusUseCase } from './update-device-status.use-case'

const mockRepo = { updateStatus: vi.fn() }
const mockEvents = { emit: vi.fn() }

describe('UpdateDeviceStatusUseCase', () => {
  const useCase = new UpdateDeviceStatusUseCase(mockRepo as any, mockEvents as any)

  beforeEach(() => vi.clearAllMocks())

  it('updates device to ONLINE and emits device.status-changed', async () => {
    const timestamp = '2026-07-05T10:00:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.ONLINE })
    await useCase.execute({ externalId: 'device-1', status: 'online', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.ONLINE, new Date(timestamp))
    expect(mockEvents.emit).toHaveBeenCalledWith('device.status-changed', {
      externalId: 'device-1', status: DeviceStatus.ONLINE, lastSeenAt: new Date(timestamp),
    })
  })

  it('updates device to OFFLINE', async () => {
    const timestamp = '2026-07-05T10:05:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.OFFLINE })
    await useCase.execute({ externalId: 'device-1', status: 'offline', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.OFFLINE, new Date(timestamp))
  })

  it('returns null and does not emit when device is unknown', async () => {
    mockRepo.updateStatus.mockResolvedValue(null)
    const result = await useCase.execute({ externalId: 'unknown-device', status: 'online', timestamp: '2026-07-05T10:00:00.000Z' })
    expect(result).toBeNull()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
