import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecordTelemetryUseCase } from './record-telemetry.use-case'

const mockRepo = { findDeviceByExternalId: vi.fn(), create: vi.fn(), listByDevice: vi.fn() }
const mockEvents = { emit: vi.fn() }

function makeUseCase() {
  return new RecordTelemetryUseCase(mockRepo as never, mockEvents as never)
}

const input = { externalId: 'device-1', lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' }

describe('RecordTelemetryUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the point and emits telemetry.recorded when the device exists', async () => {
    mockRepo.findDeviceByExternalId.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    await makeUseCase().execute(input)
    expect(mockRepo.create).toHaveBeenCalledWith({ deviceId: 'd1', lat: 1.5, lon: 2.5, recordedAt: new Date('2026-07-08T10:00:00.000Z') })
    expect(mockEvents.emit).toHaveBeenCalledWith('telemetry.recorded', {
      externalId: 'device-1', lat: 1.5, lon: 2.5, recordedAt: new Date('2026-07-08T10:00:00.000Z'),
    })
  })

  it('drops the point and emits nothing when the device is unknown', async () => {
    mockRepo.findDeviceByExternalId.mockResolvedValue(null)
    await makeUseCase().execute(input)
    expect(mockRepo.create).not.toHaveBeenCalled()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
