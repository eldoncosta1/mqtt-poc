import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useDevicesRealtime, type DevicesRealtimeHandlers } from './useDevicesRealtime'

const socketHandlers: Record<string, (...args: any[]) => void> = {}
const fakeSocket = {
  on: vi.fn((event: string, cb: (...args: any[]) => void) => {
    socketHandlers[event] = cb
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
}
const ioMock = vi.fn((..._args: unknown[]) => fakeSocket)

vi.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }))

function Harness({ handlers }: { handlers: DevicesRealtimeHandlers }) {
  useDevicesRealtime(handlers)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(socketHandlers)) delete socketHandlers[k]
})

describe('useDevicesRealtime', () => {
  it('opens a socket and subscribes to the shared devices room on connect', () => {
    render(<Harness handlers={{}} />)
    expect(ioMock).toHaveBeenCalledTimes(1)
    socketHandlers['connect']()
    expect(fakeSocket.emit).toHaveBeenCalledWith('subscribe:devices')
  })

  it('forwards device:status to the handler', () => {
    const onDeviceStatus = vi.fn()
    render(<Harness handlers={{ onDeviceStatus }} />)
    socketHandlers['device:status']({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
    expect(onDeviceStatus).toHaveBeenCalledWith({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
  })

  it('disconnects the socket on unmount', () => {
    const { unmount } = render(<Harness handlers={{}} />)
    unmount()
    expect(fakeSocket.disconnect).toHaveBeenCalled()
  })
})
