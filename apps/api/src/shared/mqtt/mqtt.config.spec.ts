import { describe, it, expect, afterEach } from 'vitest'
import { loadMqttConfig } from './mqtt.config'

describe('loadMqttConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads a valid configuration with default QoS', () => {
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    delete process.env.MQTT_QOS
    const config = loadMqttConfig()
    expect(config).toEqual({ url: 'mqtt://localhost:1883', username: undefined, password: undefined, qos: 1 })
  })

  it('throws when MQTT_URL is missing', () => {
    delete process.env.MQTT_URL
    expect(() => loadMqttConfig()).toThrow('MQTT_URL não configurada')
  })

  it('throws when MQTT_QOS is not 0, 1 or 2', () => {
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    process.env.MQTT_QOS = '5'
    expect(() => loadMqttConfig()).toThrow('MQTT_QOS inválido')
  })
})
