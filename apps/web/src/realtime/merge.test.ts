import { describe, it, expect } from 'vitest'
import { applyCommandUpdate, applyDeviceStatus, applyDeviceStatusToList } from './merge'
import type { Command, Device } from '../api/types'

const command: Command = {
  id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null,
  status: 'PENDING', response: null, createdAt: '2026-07-07T10:00:00.000Z', respondedAt: null,
}
const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'UNKNOWN', lastSeenAt: null, createdAt: '2026-07-07T10:00:00.000Z', updatedAt: '2026-07-07T10:00:00.000Z',
}

describe('applyCommandUpdate', () => {
  it('replaces status/response/respondedAt on the matching command', () => {
    const result = applyCommandUpdate([command], {
      commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt: '2026-07-07T10:00:01.000Z',
    })
    expect(result[0]).toMatchObject({ id: 'c1', status: 'ACKED', response: { ok: true }, respondedAt: '2026-07-07T10:00:01.000Z' })
  })

  it('leaves non-matching commands untouched and does not mutate the input', () => {
    const input = [command]
    const result = applyCommandUpdate(input, { commandId: 'other', status: 'ACKED', response: null, respondedAt: null })
    expect(result[0]).toEqual(command)
    expect(result).not.toBe(input)
    expect(input[0].status).toBe('PENDING')
  })
})

describe('applyDeviceStatus', () => {
  it('replaces status/lastSeenAt and does not mutate the input', () => {
    const result = applyDeviceStatus(device, { externalId: 'device-1', status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result).toMatchObject({ status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result).not.toBe(device)
    expect(device.status).toBe('UNKNOWN')
  })
})

describe('applyDeviceStatusToList', () => {
  const other: Device = { ...device, id: 'd2', externalId: 'device-2', status: 'OFFLINE' }

  it('updates only the matching device by externalId and does not mutate the input', () => {
    const input = [device, other]
    const result = applyDeviceStatusToList(input, { externalId: 'device-1', status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result[0]).toMatchObject({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result[1]).toEqual(other)
    expect(result).not.toBe(input)
    expect(input[0].status).toBe('UNKNOWN')
  })

  it('returns the list unchanged when no device matches', () => {
    const input = [device, other]
    const result = applyDeviceStatusToList(input, { externalId: 'device-999', status: 'ONLINE', lastSeenAt: null })
    expect(result).toEqual(input)
  })
})
