export interface TelemetryRepository {
  findDeviceByExternalId(externalId: string): Promise<{ id: string; externalId: string } | null>
  create(data: { deviceId: string; lat: number; lon: number; recordedAt: Date }): Promise<void>
  listByDevice(deviceId: string, limit: number): Promise<Array<{ lat: number; lon: number; recordedAt: Date }>>
}

export const TELEMETRY_REPOSITORY = Symbol('TELEMETRY_REPOSITORY')
