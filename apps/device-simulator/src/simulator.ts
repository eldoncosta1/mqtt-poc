import type { IClientOptions } from 'mqtt'
import type { SimulatorConfig } from './config'
import {
  commandsTopic,
  responsesTopic,
  statusTopic,
  parseCommand,
  buildStatusMessage,
  buildResponseMessage,
  decideResponseStatus,
} from './messages'
import { telemetryTopic, nextPosition, initialPosition, buildTelemetryMessage } from './gps'

export interface MqttLike {
  publish(topic: string, payload: string, opts: { qos: 0 | 1 | 2; retain?: boolean }, cb?: (err?: Error) => void): void
  subscribe(topic: string, opts: { qos: 0 | 1 | 2 }, cb?: (err: Error | null) => void): void
  on(event: 'connect' | 'message' | 'error', handler: (...args: any[]) => void): void
  end(force?: boolean, opts?: Record<string, unknown>, cb?: () => void): void
}

interface SimulatorDeps {
  now?: () => Date
  rng?: () => number
  setTimeout?: typeof setTimeout
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

export function buildConnectOptions(config: SimulatorConfig): IClientOptions {
  return {
    username: config.username,
    password: config.password,
    will: {
      topic: statusTopic(config.externalId),
      payload: Buffer.from(JSON.stringify(buildStatusMessage('offline'))),
      qos: config.qos,
      retain: true,
    },
  }
}

export class DeviceSimulator {
  private readonly now: () => Date
  private readonly rng: () => number
  private readonly timer: typeof setTimeout
  private readonly interval: typeof setInterval
  private readonly clearTimer: typeof clearInterval
  private heartbeat?: ReturnType<typeof setInterval>
  private gps?: ReturnType<typeof setInterval>
  private position: { lat: number; lon: number }

  constructor(
    private readonly config: SimulatorConfig,
    private readonly client: MqttLike,
    deps: SimulatorDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date())
    this.rng = deps.rng ?? Math.random
    this.timer = deps.setTimeout ?? setTimeout
    this.interval = deps.setInterval ?? setInterval
    this.clearTimer = deps.clearInterval ?? clearInterval
    this.position = initialPosition(config.gpsStartLat, config.gpsStartLon, this.rng)
  }

  start(): void {
    this.client.on('connect', () => this.handleConnect())
    this.client.on('message', (topic: string, payload: Buffer) => this.handleMessage(topic, payload))
    this.client.on('error', (err: Error) => console.error(`[simulator] erro de conexão MQTT: ${err.message}`))
  }

  stop(onEnd?: () => void): void {
    this.stopHeartbeat()
    this.stopGps()
    this.publishStatus('offline')
    this.client.end(false, {}, onEnd)
  }

  private handleConnect(): void {
    console.log(`[simulator] conectado como ${this.config.externalId}`)
    this.publishStatus('online')
    this.startHeartbeat()
    this.startGps()
    this.client.subscribe(commandsTopic(this.config.externalId), { qos: this.config.qos }, (err) => {
      if (err) console.error(`[simulator] falha ao assinar comandos: ${err.message}`)
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat() // idempotente — evita intervals duplicados numa reconexão
    if (this.config.heartbeatMs <= 0) return
    this.heartbeat = this.interval(() => this.publishStatus('online'), this.config.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      this.clearTimer(this.heartbeat)
      this.heartbeat = undefined
    }
  }

  private startGps(): void {
    this.stopGps() // idempotente — evita loops duplicados numa reconexão
    if (!this.config.gpsEnabled || this.config.gpsIntervalMs <= 0) return
    this.publishTelemetry() // primeiro ponto imediato
    this.gps = this.interval(() => this.publishTelemetry(), this.config.gpsIntervalMs)
  }

  private stopGps(): void {
    if (this.gps) {
      this.clearTimer(this.gps)
      this.gps = undefined
    }
  }

  private publishTelemetry(): void {
    this.position = nextPosition(this.position, this.config.gpsStepDeg, this.rng)
    const message = buildTelemetryMessage(this.position.lat, this.position.lon, this.now())
    this.client.publish(telemetryTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos }, (err) => {
      if (err) console.error(`[simulator] falha ao publicar telemetria: ${err.message}`)
    })
  }

  private handleMessage(_topic: string, payload: Buffer): void {
    const command = parseCommand(payload)
    if (!command) {
      console.warn(`[simulator] comando inválido descartado: ${payload.toString()}`)
      return
    }
    console.log(`[simulator] comando recebido ${command.commandId} (${command.type})`)
    this.timer(() => {
      const status = decideResponseStatus(this.config.failureRate, this.rng)
      const message = buildResponseMessage(command.commandId, status)
      this.client.publish(responsesTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos }, (err) => {
        if (err) console.error(`[simulator] falha ao publicar resposta: ${err.message}`)
      })
      console.log(`[simulator] resposta ${status} enviada para ${command.commandId}`)
    }, this.config.responseDelayMs)
  }

  private publishStatus(status: 'online' | 'offline'): void {
    const message = buildStatusMessage(status, this.now())
    this.client.publish(statusTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos, retain: true }, (err) => {
      if (err) console.error(`[simulator] falha ao publicar status ${status}: ${err.message}`)
    })
  }
}
