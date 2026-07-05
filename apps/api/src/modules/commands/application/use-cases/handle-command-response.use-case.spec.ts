import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandStatus } from '@prisma/client'
import { HandleCommandResponseUseCase } from './handle-command-response.use-case'

const mockRepo = { findByDeviceExternalIdAndId: vi.fn(), updateStatus: vi.fn() }
const mockEvents = { emit: vi.fn() }

describe('HandleCommandResponseUseCase', () => {
  const useCase = new HandleCommandResponseUseCase(mockRepo as any, mockEvents as any)

  beforeEach(() => vi.clearAllMocks())

  it('updates the command to ACKED and emits command.updated', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue({ id: 'c1' })
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', status: CommandStatus.ACKED, response: { ok: true }, respondedAt: new Date('2026-07-05T10:00:00.000Z') })

    await useCase.execute({ externalId: 'device-1', commandId: 'c1', status: 'ACKED', payload: { ok: true } })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', {
      status: CommandStatus.ACKED, response: { ok: true }, respondedAt: expect.any(Date),
    })
    expect(mockEvents.emit).toHaveBeenCalledWith('command.updated', expect.objectContaining({
      externalId: 'device-1', commandId: 'c1', status: CommandStatus.ACKED,
    }))
  })

  it('updates the command to FAILED', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue({ id: 'c1' })
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', status: CommandStatus.FAILED, response: null, respondedAt: new Date() })

    await useCase.execute({ externalId: 'device-1', commandId: 'c1', status: 'FAILED' })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', expect.objectContaining({ status: CommandStatus.FAILED }))
  })

  it('logs and does nothing when the command is unknown for that device', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue(null)
    const result = await useCase.execute({ externalId: 'device-1', commandId: 'unknown-command', status: 'ACKED' })
    expect(result).toBeNull()
    expect(mockRepo.updateStatus).not.toHaveBeenCalled()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
