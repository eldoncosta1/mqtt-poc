import {
  commandMessageSchema,
  CommandMessage,
  CommandResponseMessage,
  DeviceStatusMessage,
} from '@mqtt-poc/shared'

export const commandsTopic = (externalId: string): string => `devices/${externalId}/commands`
export const responsesTopic = (externalId: string): string => `devices/${externalId}/responses`
export const statusTopic = (externalId: string): string => `devices/${externalId}/status`

export function parseCommand(raw: Buffer | string): CommandMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw.toString())
  } catch {
    return null
  }
  const parsed = commandMessageSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function buildStatusMessage(status: 'online' | 'offline', now: Date = new Date()): DeviceStatusMessage {
  return { status, timestamp: now.toISOString() }
}

export function buildResponseMessage(commandId: string, status: 'ACKED' | 'FAILED'): CommandResponseMessage {
  return { commandId, status }
}

export function decideResponseStatus(failureRate: number, rng: () => number = Math.random): 'ACKED' | 'FAILED' {
  return rng() < failureRate ? 'FAILED' : 'ACKED'
}
