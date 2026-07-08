import { describe, it, expect } from 'vitest'
import { telemetryTopic, nextPosition, initialPosition, buildTelemetryMessage } from './gps'

describe('telemetryTopic', () => {
  it('builds the per-device telemetry topic', () => {
    expect(telemetryTopic('device-1')).toBe('devices/device-1/telemetry')
  })
})

describe('nextPosition', () => {
  it('steps lat/lon by a delta within +/- stepDeg (rng=0.5 => no movement)', () => {
    const result = nextPosition({ lat: 10, lon: 20 }, 0.001, () => 0.5)
    expect(result).toEqual({ lat: 10, lon: 20 })
  })

  it('steps to the positive edge when rng=1', () => {
    const result = nextPosition({ lat: 10, lon: 20 }, 0.001, () => 1)
    expect(result.lat).toBeCloseTo(10.001, 6)
    expect(result.lon).toBeCloseTo(20.001, 6)
  })

  it('clamps latitude to [-90, 90]', () => {
    const result = nextPosition({ lat: 89.9995, lon: 0 }, 0.001, () => 1)
    expect(result.lat).toBeLessThanOrEqual(90)
  })
})

describe('initialPosition', () => {
  it('returns the base coordinate when rng=0.5 (no offset)', () => {
    expect(initialPosition(-23.5, -46.6, () => 0.5)).toEqual({ lat: -23.5, lon: -46.6 })
  })
})

describe('buildTelemetryMessage', () => {
  it('builds a message with lat, lon and an ISO timestamp', () => {
    const msg = buildTelemetryMessage(1.5, 2.5, new Date('2026-07-08T10:00:00.000Z'))
    expect(msg).toEqual({ lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' })
  })
})
