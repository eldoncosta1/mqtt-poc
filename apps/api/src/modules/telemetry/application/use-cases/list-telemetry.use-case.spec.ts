import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ListTelemetryUseCase } from './list-telemetry.use-case'

const mockRepo = { findDeviceByExternalId: vi.fn(), create: vi.fn(), listByDevice: vi.fn() }

function makeUseCase() {
  return new ListTelemetryUseCase(mockRepo as never)
}

describe('ListTelemetryUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates to the repository with the requested limit', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 50)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 50)
  })

  it('caps the limit at 500', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 1000)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 500)
  })

  it('floors the limit at 1', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 0)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 1)
  })
})
