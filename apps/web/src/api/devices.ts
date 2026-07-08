import { api } from './client'
import type { Device } from './types'

export const devicesApi = {
  list: () => api.get<Device[]>('/devices').then((r) => r.data),
  get: (id: string) => api.get<Device>(`/devices/${id}`).then((r) => r.data),
  create: (dto: { externalId: string; name: string }) => api.post<Device>('/devices', dto).then((r) => r.data),
}
