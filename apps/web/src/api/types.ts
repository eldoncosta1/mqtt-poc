export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
export type CommandStatus = 'PENDING' | 'ACKED' | 'FAILED' | 'PUBLISH_FAILED' | 'TIMEOUT'

export interface Device {
  id: string
  externalId: string
  name: string
  status: DeviceStatus
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Command {
  id: string
  deviceId: string
  type: string
  payload: unknown
  status: CommandStatus
  response: unknown
  createdAt: string
  respondedAt: string | null
}
