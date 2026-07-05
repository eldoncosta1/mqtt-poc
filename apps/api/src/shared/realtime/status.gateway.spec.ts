import { describe, it, expect, vi } from 'vitest'
import { StatusGateway } from './status.gateway'

function makeServer() {
  const emit = vi.fn()
  const to = vi.fn().mockReturnValue({ emit })
  return { to, emit }
}

describe('StatusGateway', () => {
  it('joins the room for the given device on subscribe', () => {
    const gateway = new StatusGateway()
    const join = vi.fn()
    gateway.handleSubscribe('device-1', { join } as any)
    expect(join).toHaveBeenCalledWith('device:device-1')
  })

  it('emits command:updated to the device room when command.updated fires', () => {
    const gateway = new StatusGateway()
    const server = makeServer()
    gateway.server = server as any
    const respondedAt = new Date('2026-07-05T10:00:00.000Z')
    gateway.handleCommandUpdated({
      externalId: 'device-1', commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt,
    })
    expect(server.to).toHaveBeenCalledWith('device:device-1')
    expect(server.emit).toHaveBeenCalledWith('command:updated', {
      commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt,
    })
  })

  it('emits device:status to the device room when device.status-changed fires', () => {
    const gateway = new StatusGateway()
    const server = makeServer()
    gateway.server = server as any
    const lastSeenAt = new Date('2026-07-05T10:05:00.000Z')
    gateway.handleDeviceStatusChanged({ externalId: 'device-1', status: 'ONLINE', lastSeenAt })
    expect(server.to).toHaveBeenCalledWith('device:device-1')
    expect(server.emit).toHaveBeenCalledWith('device:status', { externalId: 'device-1', status: 'ONLINE', lastSeenAt })
  })
})
