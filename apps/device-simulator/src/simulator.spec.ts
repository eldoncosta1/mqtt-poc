import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceSimulator, buildConnectOptions, MqttLike } from './simulator'
import type { SimulatorConfig } from './config'

const config: SimulatorConfig = {
  url: 'mqtt://localhost:1883',
  username: undefined,
  password: undefined,
  qos: 1,
  externalId: 'device-1',
  responseDelayMs: 500,
  failureRate: 0,
}

function makeFakeClient() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler
    }),
    emit: (event: string, ...args: any[]) => handlers[event]?.(...args),
  }
}

describe('buildConnectOptions', () => {
  it('includes an offline LWT on the status topic with the configured qos and retain', () => {
    const opts = buildConnectOptions(config)
    expect(opts.will).toMatchObject({
      topic: 'devices/device-1/status',
      qos: 1,
      retain: true,
    })
    const willPayload = JSON.parse(opts.will!.payload as string)
    expect(willPayload.status).toBe('offline')
    expect(typeof willPayload.timestamp).toBe('string')
  })

  it('passes username and password through when present', () => {
    const opts = buildConnectOptions({ ...config, username: 'u', password: 'p' })
    expect(opts).toMatchObject({ username: 'u', password: 'p' })
  })
})

describe('DeviceSimulator', () => {
  let client: ReturnType<typeof makeFakeClient>

  beforeEach(() => {
    client = makeFakeClient()
  })

  it('on connect, publishes retained online status and subscribes to the commands topic', () => {
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { now: () => new Date('2026-07-07T10:00:00.000Z') })
    sim.start()
    client.emit('connect')

    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/status',
      JSON.stringify({ status: 'online', timestamp: '2026-07-07T10:00:00.000Z' }),
      { qos: 1, retain: true },
      expect.any(Function),
    )
    expect(client.subscribe).toHaveBeenCalledWith('devices/device-1/commands', { qos: 1 }, expect.any(Function))
  })

  it('after a valid command and the response delay, publishes an ACKED response', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { rng: () => 0.9 })
    sim.start()
    const command = { commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT' }
    client.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(command)))

    expect(client.publish).not.toHaveBeenCalledWith('devices/device-1/responses', expect.anything(), expect.anything(), expect.anything())
    vi.advanceTimersByTime(500)

    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/responses',
      JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED' }),
      { qos: 1 },
      expect.any(Function),
    )
    vi.useRealTimers()
  })

  it('drops a malformed command without publishing a response', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(config, client as unknown as MqttLike)
    sim.start()
    client.emit('message', 'devices/device-1/commands', Buffer.from('not json'))
    vi.advanceTimersByTime(5000)
    expect(client.publish).not.toHaveBeenCalledWith('devices/device-1/responses', expect.anything(), expect.anything(), expect.anything())
    vi.useRealTimers()
  })

  it('publishes a FAILED response when the rng falls below the failure rate', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, failureRate: 1 }, client as unknown as MqttLike, { rng: () => 0.0 })
    sim.start()
    const command = { commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT' }
    client.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(command)))
    vi.advanceTimersByTime(500)
    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/responses',
      JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'FAILED' }),
      { qos: 1 },
      expect.any(Function),
    )
    vi.useRealTimers()
  })

  it('on stop, publishes an offline status then ends the client', () => {
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { now: () => new Date('2026-07-07T11:00:00.000Z') })
    sim.stop()
    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/status',
      JSON.stringify({ status: 'offline', timestamp: '2026-07-07T11:00:00.000Z' }),
      { qos: 1, retain: true },
      expect.any(Function),
    )
    expect(client.end).toHaveBeenCalled()
  })
})
