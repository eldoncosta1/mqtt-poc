import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mqtt from 'mqtt'
import { PrismaService } from '../../api/src/shared/prisma/prisma.service'
import { DeviceSimulator, buildConnectOptions } from './simulator'
import type { SimulatorConfig } from './config'

function assertLocalIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    throw new Error('Testes de integração devem rodar contra um banco local (DATABASE_URL deve apontar para localhost).')
  }
}

describe('DeviceSimulator integration', () => {
  const runId = `sim-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const externalId = `device-${runId}`
  let app: INestApplication
  let moduleRef: TestingModule
  let prisma: PrismaService
  let baseUrl: string
  let simulator: DeviceSimulator
  let simClient: mqtt.MqttClient
  const deviceIds: string[] = []

  beforeAll(async () => {
    assertLocalIntegrationDatabase()
    process.env.MQTT_URL ??= 'mqtt://localhost:1883'

    const { AppModule } = await import('../../api/src/app.module')
    const { createMqttMicroserviceOptions } = await import('../../api/src/shared/mqtt/mqtt-microservice-options')

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.connectMicroservice(createMqttMicroserviceOptions())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.startAllMicroservices()
    await app.listen(0)

    prisma = app.get(PrismaService)
    baseUrl = await app.getUrl()

    const config: SimulatorConfig = {
      url: process.env.MQTT_URL as string,
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      qos: 1,
      externalId,
      responseDelayMs: 100,
      failureRate: 0,
    }
    simClient = mqtt.connect(config.url, buildConnectOptions(config))
    // Register the simulator's own 'connect' handler (which subscribes to the
    // commands topic) BEFORE the socket connects — mirroring the production
    // entrypoint (index.ts). Awaiting 'connect' before start() would register the
    // handler after the initial connect event already fired, so mqtt would never
    // replay it, the simulator would never subscribe, and no command would be ACKed.
    simulator = new DeviceSimulator(config, simClient)
    simulator.start()
    await new Promise<void>((resolve, reject) => {
      simClient.once('connect', () => resolve())
      simClient.once('error', reject)
    })
  }, 30000)

  afterAll(async () => {
    if (prisma && deviceIds.length) {
      await prisma.command.deleteMany({ where: { deviceId: { in: deviceIds } } })
      await prisma.device.deleteMany({ where: { id: { in: deviceIds } } })
    }
    simulator?.stop()
    simClient?.end(true)
    await app?.close()
    await moduleRef?.close()
  })

  it('registers a device, sends a command, and the simulator ACKs it end-to-end', async () => {
    const device = await prisma.device.create({ data: { externalId, name: `Sim ${runId}` } })
    deviceIds.push(device.id)

    const createRes = await fetch(`${baseUrl}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, type: 'REBOOT' }),
    })
    const created = (await createRes.json()) as { id: string; status: string }
    expect(created.status).toBe('PENDING')

    // poll until the simulator's response has been ingested by the API
    let finalStatus = created.status
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const res = await fetch(`${baseUrl}/commands/${created.id}`)
      finalStatus = ((await res.json()) as { status: string }).status
      if (finalStatus !== 'PENDING') break
    }
    expect(finalStatus).toBe('ACKED')
  }, 20000)
})
