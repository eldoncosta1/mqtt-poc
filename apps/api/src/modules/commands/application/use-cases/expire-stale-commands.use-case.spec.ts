import { describe, it, expect, vi } from 'vitest'
import { ExpireStaleCommandsUseCase } from './expire-stale-commands.use-case'

describe('ExpireStaleCommandsUseCase', () => {
  it('expires stale commands and emits an event for each one', async () => {
    const mockRepo = {
      expireStalePending: vi.fn().mockResolvedValue([
        { id: 'c1', deviceId: 'd1', externalId: 'device-1' },
        { id: 'c2', deviceId: 'd2', externalId: 'device-2' },
      ]),
    }
    const mockEvents = { emit: vi.fn() }
    const useCase = new ExpireStaleCommandsUseCase(mockRepo as any, mockEvents as any)

    const result = await useCase.execute(60000)

    expect(result).toHaveLength(2)
    expect(mockEvents.emit).toHaveBeenCalledTimes(2)
    expect(mockEvents.emit).toHaveBeenCalledWith('command.updated', expect.objectContaining({
      externalId: 'device-1', commandId: 'c1', status: 'TIMEOUT',
    }))
  })

  it('does not emit anything when there are no stale commands', async () => {
    const mockRepo = { expireStalePending: vi.fn().mockResolvedValue([]) }
    const mockEvents = { emit: vi.fn() }
    const useCase = new ExpireStaleCommandsUseCase(mockRepo as any, mockEvents as any)

    await useCase.execute(60000)

    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
