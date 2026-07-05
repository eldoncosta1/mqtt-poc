import { describe, it, expect, vi } from 'vitest'
import { CommandResponsesListener } from './command-responses.listener'

function makeContext(topic: string) {
  return { getTopic: () => topic } as any
}

describe('CommandResponsesListener', () => {
  it('calls the use-case with data extracted from a valid message', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new CommandResponsesListener(mockUseCase as any)
    const payload = { commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED', payload: { ok: true } }
    await listener.handleResponse(payload, makeContext('devices/device-1/responses'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({
      externalId: 'device-1', commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED', payload: { ok: true },
    })
  })

  it('discards a malformed message without calling the use-case', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new CommandResponsesListener(mockUseCase as any)
    await listener.handleResponse({ commandId: 'not-a-uuid', status: 'DONE' }, makeContext('devices/device-1/responses'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
