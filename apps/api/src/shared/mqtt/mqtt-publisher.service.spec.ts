import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { of, throwError } from 'rxjs'
import { MqttPublisherService } from './mqtt-publisher.service'

describe('MqttPublisherService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    process.env.MQTT_QOS = '1'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('emits the payload wrapped in an MqttRecord with the configured QoS, and resolves', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(of(undefined)) }
    const service = new MqttPublisherService(mockClient as any)
    await service.publish('devices/device-1/commands', { commandId: 'c1' })
    expect(mockClient.emit).toHaveBeenCalledTimes(1)
    const [topic, record] = mockClient.emit.mock.calls[0]
    expect(topic).toBe('devices/device-1/commands')
    expect(record.data).toEqual({ commandId: 'c1' })
    expect(record.options).toEqual({ qos: 1 })
  })

  it('propagates an error when the underlying client fails to publish', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(throwError(() => new Error('broker unavailable'))) }
    const service = new MqttPublisherService(mockClient as any)
    await expect(service.publish('devices/device-1/commands', {})).rejects.toThrow('broker unavailable')
  })
})
