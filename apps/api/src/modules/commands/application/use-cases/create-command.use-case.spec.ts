import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CreateCommandUseCase } from './create-command.use-case'

const mockRepo = { findDeviceById: vi.fn(), create: vi.fn(), updateStatus: vi.fn() }
const mockPublisher = { publish: vi.fn() }

describe('CreateCommandUseCase', () => {
  const useCase = new CreateCommandUseCase(mockRepo as any, mockPublisher as any)

  beforeEach(() => vi.clearAllMocks())

  it('creates and publishes a command for an existing device', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    mockRepo.create.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PENDING })
    mockPublisher.publish.mockResolvedValue(undefined)

    const result = await useCase.execute({ deviceId: 'd1', type: 'REBOOT' })

    expect(mockPublisher.publish).toHaveBeenCalledWith('devices/device-1/commands', {
      commandId: 'c1', type: 'REBOOT', payload: null,
    })
    expect(result.status).toBe(CommandStatus.PENDING)
  })

  it('throws NotFoundException when device does not exist', async () => {
    mockRepo.findDeviceById.mockResolvedValue(null)
    await expect(useCase.execute({ deviceId: 'unknown', type: 'REBOOT' })).rejects.toThrow(NotFoundException)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('marks the command as PUBLISH_FAILED when publishing fails', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    mockRepo.create.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PENDING })
    mockPublisher.publish.mockRejectedValue(new Error('broker unavailable'))
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PUBLISH_FAILED })

    const result = await useCase.execute({ deviceId: 'd1', type: 'REBOOT' })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', { status: CommandStatus.PUBLISH_FAILED })
    expect(result.status).toBe(CommandStatus.PUBLISH_FAILED)
  })
})
