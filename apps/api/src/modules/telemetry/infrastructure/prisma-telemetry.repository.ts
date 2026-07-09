import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { TelemetryRepository } from '../domain/telemetry.repository'

@Injectable()
export class PrismaTelemetryRepository implements TelemetryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDeviceByExternalId(externalId: string) {
    return this.prisma.device.findUnique({ where: { externalId }, select: { id: true, externalId: true } })
  }

  async create(data: { deviceId: string; lat: number; lon: number; recordedAt: Date }) {
    await this.prisma.telemetry.create({
      data: { deviceId: data.deviceId, lat: data.lat, lon: data.lon, recordedAt: data.recordedAt },
    })
  }

  async listByDevice(deviceId: string, limit: number) {
    const rows = await this.prisma.telemetry.findMany({
      where: { deviceId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
      select: { lat: true, lon: true, recordedAt: true },
    })
    return rows.reverse()
  }
}
