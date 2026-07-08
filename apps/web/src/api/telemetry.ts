import { api } from './client'
import type { TelemetryPoint } from './types'

export const telemetryApi = {
  list: (deviceId: string, limit = 100) =>
    api.get<TelemetryPoint[]>(`/devices/${deviceId}/telemetry`, { params: { limit } }).then((r) => r.data),
}
