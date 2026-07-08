import { describe, it, expect, vi } from 'vitest'
import { MarkStaleDevicesOfflineUseCase } from './mark-stale-devices-offline.use-case'

describe('MarkStaleDevicesOfflineUseCase', () => {
  it('marks stale devices offline and emits a status-changed event for each', async () => {
    const lastSeenAt = new Date('2026-07-08T10:00:00.000Z')
    const mockRepo = {
      markStaleOffline: vi.fn().mockResolvedValue([
        { id: 'd1', externalId: 'device-1', status: 'OFFLINE', lastSeenAt },
        { id: 'd2', externalId: 'device-2', status: 'OFFLINE', lastSeenAt },
      ]),
    }
    const mockEvents = { emit: vi.fn() }
    const useCase = new MarkStaleDevicesOfflineUseCase(mockRepo as any, mockEvents as any)

    const result = await useCase.execute(45000)

    expect(result).toHaveLength(2)
    expect(mockEvents.emit).toHaveBeenCalledTimes(2)
    expect(mockEvents.emit).toHaveBeenCalledWith('device.status-changed', {
      externalId: 'device-1',
      status: 'OFFLINE',
      lastSeenAt,
    })
  })

  it('passes a cutoff of now minus the timeout to the repository', async () => {
    const mockRepo = { markStaleOffline: vi.fn().mockResolvedValue([]) }
    const useCase = new MarkStaleDevicesOfflineUseCase(mockRepo as any, { emit: vi.fn() } as any)

    const before = Date.now()
    await useCase.execute(45000)
    const cutoff = mockRepo.markStaleOffline.mock.calls[0][0] as Date

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 45000 - 1000)
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 45000)
  })

  it('does not emit anything when there are no stale devices', async () => {
    const mockRepo = { markStaleOffline: vi.fn().mockResolvedValue([]) }
    const mockEvents = { emit: vi.fn() }
    const useCase = new MarkStaleDevicesOfflineUseCase(mockRepo as any, mockEvents as any)

    await useCase.execute(45000)

    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
