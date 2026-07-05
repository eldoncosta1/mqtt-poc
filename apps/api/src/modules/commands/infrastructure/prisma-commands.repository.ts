import { Injectable } from '@nestjs/common'
import { CommandStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { CommandsRepository } from '../domain/commands.repository'

@Injectable()
export class PrismaCommandsRepository implements CommandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { deviceId: string; type: string; payload?: unknown }) {
    return this.prisma.command.create({
      data: {
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue | undefined,
      },
    })
  }

  async updateStatus(id: string, data: { status: CommandStatus; response?: unknown; respondedAt?: Date }) {
    try {
      return await this.prisma.command.update({
        where: { id },
        data: {
          status: data.status,
          response: data.response as Prisma.InputJsonValue | undefined,
          respondedAt: data.respondedAt,
        },
      })
    } catch {
      return null
    }
  }

  findById(id: string) {
    return this.prisma.command.findUnique({ where: { id } })
  }

  list(status?: CommandStatus) {
    return this.prisma.command.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    })
  }

  findDeviceById(deviceId: string) {
    return this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, externalId: true } })
  }

  findByDeviceExternalIdAndId(externalId: string, commandId: string) {
    return this.prisma.command.findFirst({ where: { id: commandId, device: { externalId } } })
  }

  async expireStalePending(cutoff: Date) {
    return this.prisma.$queryRaw<Array<{ id: string; deviceId: string; externalId: string }>>`
      UPDATE "Command" c
      SET status = 'TIMEOUT', "respondedAt" = now()
      FROM "Device" d
      WHERE c."deviceId" = d.id
        AND c.status = 'PENDING'
        AND c."createdAt" < ${cutoff}
      RETURNING c.id, c."deviceId", d."externalId"
    `
  }
}
