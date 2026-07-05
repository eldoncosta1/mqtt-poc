import { describe, it, expect } from 'vitest'
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
})
