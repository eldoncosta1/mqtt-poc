import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrismaTelemetryRepository } from './prisma-telemetry.repository'

function makePrisma() {
  return {
    device: { findUnique: vi.fn() },
    telemetry: { create: vi.fn(), findMany: vi.fn() },
  }
}

describe('PrismaTelemetryRepository', () => {
  let prisma: ReturnType<typeof makePrisma>
  let repo: PrismaTelemetryRepository

  beforeEach(() => {
    prisma = makePrisma()
    repo = new PrismaTelemetryRepository(prisma as never)
  })

  it('findDeviceByExternalId selects id and externalId', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    const result = await repo.findDeviceByExternalId('device-1')
    expect(prisma.device.findUnique).toHaveBeenCalledWith({ where: { externalId: 'device-1' }, select: { id: true, externalId: true } })
    expect(result).toEqual({ id: 'd1', externalId: 'device-1' })
  })

  it('create inserts a telemetry row', async () => {
    const recordedAt = new Date('2026-07-08T10:00:00.000Z')
    await repo.create({ deviceId: 'd1', lat: 1, lon: 2, recordedAt })
    expect(prisma.telemetry.create).toHaveBeenCalledWith({ data: { deviceId: 'd1', lat: 1, lon: 2, recordedAt } })
  })

  it('listByDevice queries the newest N and returns them ascending', async () => {
    prisma.telemetry.findMany.mockResolvedValue([
      { lat: 3, lon: 3, recordedAt: new Date('2026-07-08T10:02:00.000Z') },
      { lat: 2, lon: 2, recordedAt: new Date('2026-07-08T10:01:00.000Z') },
    ])
    const result = await repo.listByDevice('d1', 100)
    expect(prisma.telemetry.findMany).toHaveBeenCalledWith({
      where: { deviceId: 'd1' },
      orderBy: { recordedAt: 'desc' },
      take: 100,
      select: { lat: true, lon: true, recordedAt: true },
    })
    expect(result.map((p) => p.lat)).toEqual([2, 3]) // reversed to ascending
  })
})
