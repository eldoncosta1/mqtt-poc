import type { Command, CommandStatus, Device, DeviceStatus } from '../api/types'

export interface CommandUpdate {
  commandId: string
  status: CommandStatus
  response: unknown
  respondedAt: string | null
}

export interface DeviceStatusUpdate {
  externalId: string
  status: DeviceStatus
  lastSeenAt: string | null
}

export function applyCommandUpdate(commands: Command[], update: CommandUpdate): Command[] {
  return commands.map((c) =>
    c.id === update.commandId
      ? { ...c, status: update.status, response: update.response, respondedAt: update.respondedAt }
      : c,
  )
}

export function applyDeviceStatus(device: Device, update: DeviceStatusUpdate): Device {
  return { ...device, status: update.status, lastSeenAt: update.lastSeenAt }
}
