import { describe, it, expect } from 'vitest'
import { loadSimulatorConfig } from './config'

const baseEnv = {
  MQTT_URL: 'mqtt://localhost:1883',
  DEVICE_EXTERNAL_ID: 'device-001',
}

describe('loadSimulatorConfig', () => {
  it('loads a valid config with defaults', () => {
    const config = loadSimulatorConfig(baseEnv, [])
    expect(config).toEqual({
      url: 'mqtt://localhost:1883',
      username: undefined,
      password: undefined,
      qos: 1,
      externalId: 'device-001',
      responseDelayMs: 1000,
      failureRate: 0,
    })
  })

  it('lets a --externalId CLI arg override DEVICE_EXTERNAL_ID', () => {
    const config = loadSimulatorConfig(baseEnv, ['--externalId=device-999'])
    expect(config.externalId).toBe('device-999')
  })

  it('parses username, password, qos, delay and failure rate from env', () => {
    const config = loadSimulatorConfig(
      { ...baseEnv, MQTT_USERNAME: 'u', MQTT_PASSWORD: 'p', MQTT_QOS: '2', SIMULATOR_RESPONSE_DELAY_MS: '500', SIMULATOR_FAILURE_RATE: '0.5' },
      [],
    )
    expect(config).toMatchObject({ username: 'u', password: 'p', qos: 2, responseDelayMs: 500, failureRate: 0.5 })
  })

  it('throws when MQTT_URL is missing', () => {
    expect(() => loadSimulatorConfig({ DEVICE_EXTERNAL_ID: 'd1' }, [])).toThrow('MQTT_URL não configurada')
  })

  it('throws when externalId is missing (no env and no CLI arg)', () => {
    expect(() => loadSimulatorConfig({ MQTT_URL: 'mqtt://localhost:1883' }, [])).toThrow('externalId não configurado')
  })

  it('throws when MQTT_QOS is not 0, 1 or 2', () => {
    expect(() => loadSimulatorConfig({ ...baseEnv, MQTT_QOS: '5' }, [])).toThrow('MQTT_QOS inválido')
  })

  it('throws when SIMULATOR_FAILURE_RATE is outside 0..1', () => {
    expect(() => loadSimulatorConfig({ ...baseEnv, SIMULATOR_FAILURE_RATE: '2' }, [])).toThrow('SIMULATOR_FAILURE_RATE inválido')
  })
})
