import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelemetryListener } from './telemetry.listener'

const mockUseCase = { execute: vi.fn() }
const ctx = (topic: string) => ({ getTopic: () => topic }) as never

function makeListener() {
  return new TelemetryListener(mockUseCase as never)
}

describe('TelemetryListener', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a valid telemetry message with the externalId from the topic', async () => {
    const data = { lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' }
    await makeListener().handleTelemetry(data, ctx('devices/device-1/telemetry'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({ externalId: 'device-1', lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' })
  })

  it('drops an invalid telemetry message', async () => {
    await makeListener().handleTelemetry({ lat: 999 }, ctx('devices/device-1/telemetry'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
