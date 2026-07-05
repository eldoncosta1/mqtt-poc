import { describe, it, expect, vi } from 'vitest'
import { ListDevicesUseCase } from './list-devices.use-case'

describe('ListDevicesUseCase', () => {
  it('returns all devices from the repository', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]) }
    const useCase = new ListDevicesUseCase(mockRepo as any)
    const result = await useCase.execute()
    expect(result).toHaveLength(2)
  })
})
