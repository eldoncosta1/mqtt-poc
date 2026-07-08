import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeviceStatus } from '@prisma/client'
import { UpdateDeviceStatusUseCase } from './update-device-status.use-case'

const mockRepo = { updateStatus: vi.fn() }
const mockEvents = { emit: vi.fn() }

// lastSeenAt usa o horário de recebimento no servidor (new Date()), não o timestamp do device.
const serverNow = new Date('2026-07-08T18:00:00.000Z')

describe('UpdateDeviceStatusUseCase', () => {
  const useCase = new UpdateDeviceStatusUseCase(mockRepo as any, mockEvents as any)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(serverNow)
  })
  afterEach(() => vi.useRealTimers())

  it('updates device to ONLINE with the server receive time and emits device.status-changed', async () => {
    // timestamp do device propositalmente no passado — não deve ser usado para lastSeenAt
    const timestamp = '2026-07-05T10:00:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.ONLINE })
    await useCase.execute({ externalId: 'device-1', status: 'online', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.ONLINE, serverNow)
    expect(mockEvents.emit).toHaveBeenCalledWith('device.status-changed', {
      externalId: 'device-1', status: DeviceStatus.ONLINE, lastSeenAt: serverNow,
    })
  })

  it('updates device to OFFLINE with the server receive time', async () => {
    const timestamp = '2026-07-05T10:05:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.OFFLINE })
    await useCase.execute({ externalId: 'device-1', status: 'offline', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.OFFLINE, serverNow)
  })

  it('returns null and does not emit when device is unknown', async () => {
    mockRepo.updateStatus.mockResolvedValue(null)
    const result = await useCase.execute({ externalId: 'unknown-device', status: 'online', timestamp: '2026-07-05T10:00:00.000Z' })
    expect(result).toBeNull()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
