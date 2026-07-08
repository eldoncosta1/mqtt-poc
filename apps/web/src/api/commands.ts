import { api } from './client'
import type { Command } from './types'

export const commandsApi = {
  list: () => api.get<Command[]>('/commands').then((r) => r.data),
  get: (id: string) => api.get<Command>(`/commands/${id}`).then((r) => r.data),
  create: (dto: { deviceId: string; type: string; payload?: Record<string, unknown> }) =>
    api.post<Command>('/commands', dto).then((r) => r.data),
}
