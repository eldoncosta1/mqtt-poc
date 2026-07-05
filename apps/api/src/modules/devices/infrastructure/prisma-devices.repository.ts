import { Injectable } from '@nestjs/common'
import { DeviceStatus } from '@prisma/client'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { DevicesRepository } from '../domain/devices.repository'

@Injectable()
export class PrismaDevicesRepository implements DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { externalId: string; name: string }) {
    return this.prisma.device.create({ data })
  }

  findById(id: string) {
    return this.prisma.device.findUnique({ where: { id } })
  }

  findByExternalId(externalId: string) {
    return this.prisma.device.findUnique({ where: { externalId } })
  }

  list() {
    return this.prisma.device.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async updateStatus(externalId: string, status: DeviceStatus, lastSeenAt: Date) {
    try {
      return await this.prisma.device.update({ where: { externalId }, data: { status, lastSeenAt } })
    } catch {
      return null
    }
  }
}
