import { z } from 'zod'

export const commandMessageSchema = z.object({
  commandId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown().optional(),
})
export type CommandMessage = z.infer<typeof commandMessageSchema>

export const commandResponseMessageSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(['ACKED', 'FAILED']),
  payload: z.unknown().optional(),
})
export type CommandResponseMessage = z.infer<typeof commandResponseMessageSchema>

export const deviceStatusMessageSchema = z.object({
  status: z.enum(['online', 'offline']),
  timestamp: z.string().datetime(),
})
export type DeviceStatusMessage = z.infer<typeof deviceStatusMessageSchema>
