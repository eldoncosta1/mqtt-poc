import { describe, it, expect, vi } from 'vitest'
import { CommandStatus } from '@prisma/client'
import { ListCommandsUseCase } from './list-commands.use-case'

describe('ListCommandsUseCase', () => {
  it('lists all commands when no status filter is given', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([{ id: 'c1' }]) }
    const useCase = new ListCommandsUseCase(mockRepo as any)
    await useCase.execute()
    expect(mockRepo.list).toHaveBeenCalledWith(undefined)
  })

  it('forwards the status filter to the repository', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([]) }
    const useCase = new ListCommandsUseCase(mockRepo as any)
    await useCase.execute(CommandStatus.PENDING)
    expect(mockRepo.list).toHaveBeenCalledWith(CommandStatus.PENDING)
  })
})
