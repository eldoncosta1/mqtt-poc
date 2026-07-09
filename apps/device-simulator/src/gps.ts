import type { GpsTelemetryMessage } from '@mqtt-poc/shared'

const INITIAL_SPREAD_DEG = 0.02 // devices começam espalhados num raio pequeno

export const telemetryTopic = (externalId: string): string => `devices/${externalId}/telemetry`

const clampLat = (v: number): number => Math.min(90, Math.max(-90, v))
const clampLon = (v: number): number => Math.min(180, Math.max(-180, v))

export function nextPosition(
  current: { lat: number; lon: number },
  stepDeg: number,
  rng: () => number = Math.random,
): { lat: number; lon: number } {
  const dLat = (rng() * 2 - 1) * stepDeg
  const dLon = (rng() * 2 - 1) * stepDeg
  return { lat: clampLat(current.lat + dLat), lon: clampLon(current.lon + dLon) }
}

export function initialPosition(
  startLat: number,
  startLon: number,
  rng: () => number = Math.random,
): { lat: number; lon: number } {
  const dLat = (rng() * 2 - 1) * INITIAL_SPREAD_DEG
  const dLon = (rng() * 2 - 1) * INITIAL_SPREAD_DEG
  return { lat: clampLat(startLat + dLat), lon: clampLon(startLon + dLon) }
}

export function buildTelemetryMessage(lat: number, lon: number, now: Date = new Date()): GpsTelemetryMessage {
  return { lat, lon, timestamp: now.toISOString() }
}
