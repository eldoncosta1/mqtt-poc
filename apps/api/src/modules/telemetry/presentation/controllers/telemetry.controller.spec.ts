import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelemetryController } from './telemetry.controller'

const mockUseCase = { execute: vi.fn() }

function makeController() {
  return new TelemetryController(mockUseCase as never)
}

describe('TelemetryController', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists telemetry with the provided limit', async () => {
    mockUseCase.execute.mockResolvedValue([])
    await makeController().list('d1', { limit: 50 })
    expect(mockUseCase.execute).toHaveBeenCalledWith('d1', 50)
  })

  it('defaults the limit to 100 when omitted', async () => {
    mockUseCase.execute.mockResolvedValue([])
    await makeController().list('d1', {})
    expect(mockUseCase.execute).toHaveBeenCalledWith('d1', 100)
  })
})
