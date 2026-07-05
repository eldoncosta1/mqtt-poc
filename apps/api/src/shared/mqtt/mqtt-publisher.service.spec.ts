import { describe, it, expect, vi } from 'vitest'
import { of, throwError } from 'rxjs'
import { MqttPublisherService } from './mqtt-publisher.service'

describe('MqttPublisherService', () => {
  it('emits the payload on the given topic and resolves', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(of(undefined)) }
    const service = new MqttPublisherService(mockClient as any)
    await service.publish('devices/device-1/commands', { commandId: 'c1' })
    expect(mockClient.emit).toHaveBeenCalledWith('devices/device-1/commands', { commandId: 'c1' })
  })

  it('propagates an error when the underlying client fails to publish', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(throwError(() => new Error('broker unavailable'))) }
    const service = new MqttPublisherService(mockClient as any)
    await expect(service.publish('devices/device-1/commands', {})).rejects.toThrow('broker unavailable')
  })
})
