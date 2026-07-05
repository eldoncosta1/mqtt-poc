import { describe, it, expect, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { GetCommandUseCase } from './get-command.use-case'

describe('GetCommandUseCase', () => {
  it('returns the command when found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }) }
    const useCase = new GetCommandUseCase(mockRepo as any)
    const result = await useCase.execute('c1')
    expect(result.id).toBe('c1')
  })

  it('throws NotFoundException when command does not exist', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(null) }
    const useCase = new GetCommandUseCase(mockRepo as any)
    await expect(useCase.execute('unknown')).rejects.toThrow(NotFoundException)
  })
})
