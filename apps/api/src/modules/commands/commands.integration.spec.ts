import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mqtt, { type MqttClient } from 'mqtt'
import { PrismaService } from '../../shared/prisma/prisma.service'

function assertLocalIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    throw new Error('Testes de integração devem rodar contra um banco local (DATABASE_URL deve apontar para localhost).')
  }
}

describe('Commands integration', () => {
  const runId = `cmd-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let app: INestApplication
  let moduleRef: TestingModule
  let prisma: PrismaService
  let baseUrl: string
  let deviceClient: MqttClient
  const deviceExternalId = `device-${runId}`
  const deviceIds: string[] = []

  async function cleanup() {
    if (!prisma) return
    await prisma.command.deleteMany({ where: { deviceId: { in: deviceIds } } })
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } })
  }

  beforeAll(async () => {
    assertLocalIntegrationDatabase()

    const { AppModule } = await import('../../app.module')
    const { createMqttMicroserviceOptions } = await import('../../shared/mqtt/mqtt-microservice-options')

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.connectMicroservice(createMqttMicroserviceOptions())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.startAllMicroservices()
    await app.listen(0)

    prisma = app.get(PrismaService)
    baseUrl = await app.getUrl()

    deviceClient = mqtt.connect(process.env.MQTT_URL as string, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
    })
    await new Promise<void>((resolve, reject) => {
      deviceClient.once('connect', () => resolve())
      deviceClient.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      deviceClient.subscribe(`devices/${deviceExternalId}/commands`, (err) => (err ? reject(err) : resolve()))
    })
  }, 30000)

  afterAll(async () => {
    await cleanup()
    deviceClient?.end(true)
    await app?.close()
    await moduleRef?.close()
  })

  it('delivers a command to the device and processes its ACKED response', async () => {
    const device = await prisma.device.create({
      data: { externalId: deviceExternalId, name: `Dispositivo ${runId}` },
    })
    deviceIds.push(device.id)

    const commandReceived = new Promise<{ commandId: string; type: string }>((resolve) => {
      deviceClient.once('message', (_topic, buffer) => {
        resolve(JSON.parse(buffer.toString()))
      })
    })

    const createRes = await fetch(`${baseUrl}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, type: 'REBOOT' }),
    })
    const created = (await createRes.json()) as { id: string; status: string }
    expect(created.status).toBe('PENDING')

    const received = await commandReceived
    expect(received.commandId).toBe(created.id)
    expect(received.type).toBe('REBOOT')

    deviceClient.publish(
      `devices/${deviceExternalId}/responses`,
      JSON.stringify({ commandId: created.id, status: 'ACKED', payload: { ok: true } }),
    )

    await new Promise((resolve) => setTimeout(resolve, 500))

    const getRes = await fetch(`${baseUrl}/commands/${created.id}`)
    const updated = (await getRes.json()) as { status: string; response: unknown }
    expect(updated.status).toBe('ACKED')
    expect(updated.response).toEqual({ ok: true })
  }, 15000)

  it('updates device status to ONLINE then OFFLINE via a message with LWT configured', async () => {
    const externalId = `device-lwt-${runId}`
    const device = await prisma.device.create({ data: { externalId, name: `LWT ${runId}` } })
    deviceIds.push(device.id)

    const lwtClient = mqtt.connect(process.env.MQTT_URL as string, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      will: {
        topic: `devices/${externalId}/status`,
        payload: JSON.stringify({ status: 'offline', timestamp: new Date().toISOString() }),
        qos: 1,
        retain: true,
      },
    })
    await new Promise<void>((resolve, reject) => {
      lwtClient.once('connect', () => resolve())
      lwtClient.once('error', reject)
    })
    lwtClient.publish(
      `devices/${externalId}/status`,
      JSON.stringify({ status: 'online', timestamp: new Date().toISOString() }),
      { qos: 1, retain: true },
    )

    await new Promise((resolve) => setTimeout(resolve, 500))
    const onlineRes = await fetch(`${baseUrl}/devices/${device.id}`)
    const online = (await onlineRes.json()) as { status: string }
    expect(online.status).toBe('ONLINE')

    lwtClient.end(true)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const offlineRes = await fetch(`${baseUrl}/devices/${device.id}`)
    const offline = (await offlineRes.json()) as { status: string }
    expect(offline.status).toBe('OFFLINE')
  }, 15000)

  it('expires a stale PENDING command exactly once even if triggered twice concurrently', async () => {
    const device = await prisma.device.create({
      data: { externalId: `device-timeout-${runId}`, name: `Timeout ${runId}` },
    })
    deviceIds.push(device.id)

    const staleCommand = await prisma.command.create({ data: { deviceId: device.id, type: 'REBOOT' } })
    await prisma.command.update({
      where: { id: staleCommand.id },
      data: { createdAt: new Date(Date.now() - 1000 * 60 * 60) },
    })

    const { ExpireStaleCommandsUseCase } = await import('./application/use-cases/expire-stale-commands.use-case')
    const useCase = app.get(ExpireStaleCommandsUseCase)

    const [firstRun, secondRun] = await Promise.all([useCase.execute(1000), useCase.execute(1000)])

    expect(firstRun.length + secondRun.length).toBe(1)

    const finalCommand = await prisma.command.findUniqueOrThrow({ where: { id: staleCommand.id } })
    expect(finalCommand.status).toBe('TIMEOUT')
  }, 15000)
})
