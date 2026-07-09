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
  heartbeatMs: 0,
  gpsEnabled: false,
  gpsIntervalMs: 0,
  gpsStartLat: -23.5,
  gpsStartLon: -46.6,
  gpsStepDeg: 0.001,
}

function makeFakeClient() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn((_force?: boolean, _opts?: any, cb?: () => void) => cb && cb()),
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

  it('on connect, starts a heartbeat that republishes online on the configured interval', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, heartbeatMs: 15000 }, client as unknown as MqttLike)
    sim.start()
    client.emit('connect')

    const statusPublishes = () =>
      client.publish.mock.calls.filter((c) => c[0] === 'devices/device-1/status').length

    expect(statusPublishes()).toBe(1) // online inicial no connect
    vi.advanceTimersByTime(15000)
    expect(statusPublishes()).toBe(2) // primeira batida
    vi.advanceTimersByTime(15000)
    expect(statusPublishes()).toBe(3) // segunda batida
    vi.useRealTimers()
  })

  it('does not start a heartbeat when heartbeatMs is 0', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, heartbeatMs: 0 }, client as unknown as MqttLike)
    sim.start()
    client.emit('connect')

    const statusPublishes = () =>
      client.publish.mock.calls.filter((c) => c[0] === 'devices/device-1/status').length
    const initial = statusPublishes()
    vi.advanceTimersByTime(60000)
    expect(statusPublishes()).toBe(initial) // nenhuma batida extra
    vi.useRealTimers()
  })

  it('stops the heartbeat on stop', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, heartbeatMs: 15000 }, client as unknown as MqttLike)
    sim.start()
    client.emit('connect')
    sim.stop()

    const callsAfterStop = client.publish.mock.calls.length
    vi.advanceTimersByTime(60000)
    expect(client.publish.mock.calls.length).toBe(callsAfterStop) // sem mais batidas
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

  it('on stop, invokes the provided completion callback once the client ends', () => {
    const sim = new DeviceSimulator(config, client as unknown as MqttLike)
    const onEnd = vi.fn()
    sim.stop(onEnd)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})

describe('DeviceSimulator GPS telemetry (command-driven)', () => {
  let client: ReturnType<typeof makeFakeClient>
  beforeEach(() => { client = makeFakeClient() })

  const gpsConfig = { ...config, gpsEnabled: true, gpsIntervalMs: 3000 }
  const START = { commandId: '11111111-1111-1111-1111-111111111111', type: 'START_TELEMETRY' }
  const STOP = { commandId: '22222222-2222-2222-2222-222222222222', type: 'STOP_TELEMETRY' }

  const telemetryPublishes = (c: ReturnType<typeof makeFakeClient>) =>
    c.publish.mock.calls.filter((call) => call[0] === 'devices/device-1/telemetry').length

  const sendCommand = (c: ReturnType<typeof makeFakeClient>, cmd: unknown) =>
    c.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(cmd)))

  it('does not publish telemetry on connect (collection is command-driven)', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0)
    vi.useRealTimers()
  })

  it('starts publishing after a START_TELEMETRY command is ACKed', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    expect(telemetryPublishes(client)).toBe(0) // aguarda o ACK (responseDelayMs)
    vi.advanceTimersByTime(500) // ACK -> startGps -> primeiro ponto imediato
    expect(telemetryPublishes(client)).toBe(1)
    vi.advanceTimersByTime(3000)
    expect(telemetryPublishes(client)).toBe(2)
    vi.useRealTimers()
  })

  it('stops publishing after a STOP_TELEMETRY command is ACKed', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(500)
    sendCommand(client, STOP)
    vi.advanceTimersByTime(500) // ACK -> stopGps
    const afterStop = telemetryPublishes(client)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(afterStop) // nenhuma telemetria nova
    vi.useRealTimers()
  })

  it('does not start GPS when a START_TELEMETRY command FAILs', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...gpsConfig, failureRate: 1 }, client as unknown as MqttLike, { rng: () => 0.0 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0) // FAILED -> estado inalterado
    vi.useRealTimers()
  })

  it('does not start GPS on a START_TELEMETRY when SIMULATOR_GPS_ENABLED is false', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...gpsConfig, gpsEnabled: false }, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0) // trava-mestra
    vi.useRealTimers()
  })

  it('stops the GPS loop on stop after it was started by command', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(500)
    sim.stop()
    const afterStop = telemetryPublishes(client)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(afterStop)
    vi.useRealTimers()
  })
})
