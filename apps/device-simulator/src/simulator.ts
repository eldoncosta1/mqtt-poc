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

  constructor(
    private readonly config: SimulatorConfig,
    private readonly client: MqttLike,
    deps: SimulatorDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date())
    this.rng = deps.rng ?? Math.random
    this.timer = deps.setTimeout ?? setTimeout
  }

  start(): void {
    this.client.on('connect', () => this.handleConnect())
    this.client.on('message', (topic: string, payload: Buffer) => this.handleMessage(topic, payload))
    this.client.on('error', (err: Error) => console.error(`[simulator] erro de conexão MQTT: ${err.message}`))
  }

  stop(onEnd?: () => void): void {
    this.publishStatus('offline')
    this.client.end(false, {}, onEnd)
  }

  private handleConnect(): void {
    console.log(`[simulator] conectado como ${this.config.externalId}`)
    this.publishStatus('online')
    this.client.subscribe(commandsTopic(this.config.externalId), { qos: this.config.qos }, (err) => {
      if (err) console.error(`[simulator] falha ao assinar comandos: ${err.message}`)
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
