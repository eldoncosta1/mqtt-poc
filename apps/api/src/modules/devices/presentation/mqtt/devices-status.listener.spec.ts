import { describe, it, expect, vi } from 'vitest'
import { DevicesStatusListener } from './devices-status.listener'

function makeContext(topic: string) {
  return { getTopic: () => topic } as any
}

describe('DevicesStatusListener', () => {
  it('calls the use-case with data extracted from a valid message', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new DevicesStatusListener(mockUseCase as any)
    const payload = { status: 'online', timestamp: '2026-07-05T10:00:00.000Z' }
    await listener.handleStatus(payload, makeContext('devices/device-1/status'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({ externalId: 'device-1', status: 'online', timestamp: '2026-07-05T10:00:00.000Z' })
  })

  it('discards a malformed message without calling the use-case', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new DevicesStatusListener(mockUseCase as any)
    await listener.handleStatus({ status: 'not-a-real-status' }, makeContext('devices/device-1/status'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
