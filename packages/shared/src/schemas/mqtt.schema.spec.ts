import { describe, it, expect } from 'vitest'
import { commandMessageSchema, commandResponseMessageSchema, deviceStatusMessageSchema } from './mqtt.schema'

describe('commandMessageSchema', () => {
  it('parses a valid command message', () => {
    const result = commandMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'REBOOT',
      payload: { delaySeconds: 5 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a message without commandId', () => {
    const result = commandMessageSchema.safeParse({ type: 'REBOOT' })
    expect(result.success).toBe(false)
  })
})

describe('commandResponseMessageSchema', () => {
  it('parses a valid ACKED response', () => {
    const result = commandResponseMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'ACKED',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status value', () => {
    const result = commandResponseMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'DONE',
    })
    expect(result.success).toBe(false)
  })
})

describe('deviceStatusMessageSchema', () => {
  it('parses a valid online status message', () => {
    const result = deviceStatusMessageSchema.safeParse({
      status: 'online',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing timestamp', () => {
    const result = deviceStatusMessageSchema.safeParse({ status: 'online' })
    expect(result.success).toBe(false)
  })
})
