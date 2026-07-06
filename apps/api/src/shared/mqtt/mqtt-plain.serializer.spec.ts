import { describe, it, expect } from 'vitest'
import { MqttRecordBuilder } from '@nestjs/microservices'
import { MqttPlainSerializer } from './mqtt-plain.serializer'

describe('MqttPlainSerializer', () => {
  it('returns only the data payload, dropping the pattern envelope', () => {
    const serializer = new MqttPlainSerializer()
    const result = serializer.serialize({ pattern: 'devices/device-1/commands', data: { commandId: 'c1', type: 'REBOOT', payload: null } })
    expect(result).toEqual({ commandId: 'c1', type: 'REBOOT', payload: null })
  })

  it('does not leak the pattern field into the output', () => {
    const serializer = new MqttPlainSerializer()
    const result = serializer.serialize({ pattern: 'devices/device-1/commands', data: { foo: 'bar' } })
    expect(result).not.toHaveProperty('pattern')
  })

  it('unwraps an MqttRecord, merging its data with its options for QoS extraction', () => {
    const serializer = new MqttPlainSerializer()
    const record = new MqttRecordBuilder({ commandId: 'c1', type: 'REBOOT' }).setQoS(1).build()
    const result = serializer.serialize({ pattern: 'devices/device-1/commands', data: record })
    expect(result).toEqual({ commandId: 'c1', type: 'REBOOT', options: { qos: 1 } })
  })
})
