import { describe, it, expect } from 'vitest'
import {
  commandsTopic,
  responsesTopic,
  statusTopic,
  parseCommand,
  buildStatusMessage,
  buildResponseMessage,
  decideResponseStatus,
} from './messages'

describe('topic helpers', () => {
  it('builds the three device topics from an externalId', () => {
    expect(commandsTopic('device-1')).toBe('devices/device-1/commands')
    expect(responsesTopic('device-1')).toBe('devices/device-1/responses')
    expect(statusTopic('device-1')).toBe('devices/device-1/status')
  })
})

describe('parseCommand', () => {
  it('parses a valid command message from a Buffer', () => {
    const raw = Buffer.from(JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT', payload: { x: 1 } }))
    const result = parseCommand(raw)
    expect(result).toEqual({ commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT', payload: { x: 1 } })
  })

  it('returns null for invalid JSON', () => {
    expect(parseCommand(Buffer.from('not json'))).toBeNull()
  })

  it('returns null for a schema-invalid message (missing commandId)', () => {
    expect(parseCommand(Buffer.from(JSON.stringify({ type: 'REBOOT' })))).toBeNull()
  })
})

describe('buildStatusMessage', () => {
  it('builds an online status message with an ISO timestamp', () => {
    const msg = buildStatusMessage('online', new Date('2026-07-07T10:00:00.000Z'))
    expect(msg).toEqual({ status: 'online', timestamp: '2026-07-07T10:00:00.000Z' })
  })
})

describe('buildResponseMessage', () => {
  it('builds an ACKED response for a command id', () => {
    expect(buildResponseMessage('c1', 'ACKED')).toEqual({ commandId: 'c1', status: 'ACKED' })
  })
})

describe('decideResponseStatus', () => {
  it('returns FAILED when rng is below the failure rate', () => {
    expect(decideResponseStatus(0.5, () => 0.1)).toBe('FAILED')
  })

  it('returns ACKED when rng is at or above the failure rate', () => {
    expect(decideResponseStatus(0.5, () => 0.9)).toBe('ACKED')
  })

  it('always returns ACKED when failure rate is 0', () => {
    expect(decideResponseStatus(0, () => 0)).toBe('ACKED')
  })
})
