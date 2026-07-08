import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useDeviceRealtime, type DeviceRealtimeHandlers } from './useDeviceRealtime'

const socketHandlers: Record<string, (...args: any[]) => void> = {}
const fakeSocket = {
  on: vi.fn((event: string, cb: (...args: any[]) => void) => {
    socketHandlers[event] = cb
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
}
const ioMock = vi.fn(() => fakeSocket)

vi.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }))

function Harness({ externalId, handlers }: { externalId?: string; handlers: DeviceRealtimeHandlers }) {
  useDeviceRealtime(externalId, handlers)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(socketHandlers)) delete socketHandlers[k]
})

describe('useDeviceRealtime', () => {
  it('does not open a socket when externalId is undefined', () => {
    render(<Harness handlers={{}} />)
    expect(ioMock).not.toHaveBeenCalled()
  })

  it('subscribes to the device room on connect', () => {
    render(<Harness externalId="device-1" handlers={{}} />)
    expect(ioMock).toHaveBeenCalledTimes(1)
    socketHandlers['connect']()
    expect(fakeSocket.emit).toHaveBeenCalledWith('subscribe:device', 'device-1')
  })

  it('forwards command:updated and device:status to the handlers', () => {
    const onCommandUpdated = vi.fn()
    const onDeviceStatus = vi.fn()
    render(<Harness externalId="device-1" handlers={{ onCommandUpdated, onDeviceStatus }} />)
    socketHandlers['command:updated']({ commandId: 'c1', status: 'ACKED', response: null, respondedAt: null })
    socketHandlers['device:status']({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
    expect(onCommandUpdated).toHaveBeenCalledWith({ commandId: 'c1', status: 'ACKED', response: null, respondedAt: null })
    expect(onDeviceStatus).toHaveBeenCalledWith({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
  })

  it('disconnects the socket on unmount', () => {
    const { unmount } = render(<Harness externalId="device-1" handlers={{}} />)
    unmount()
    expect(fakeSocket.disconnect).toHaveBeenCalled()
  })
})
