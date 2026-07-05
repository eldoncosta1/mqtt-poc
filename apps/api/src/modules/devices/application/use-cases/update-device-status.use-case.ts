import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DeviceStatus } from '@prisma/client'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class UpdateDeviceStatusUseCase {
  private readonly logger = new Logger(UpdateDeviceStatusUseCase.name)

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; status: 'online' | 'offline'; timestamp: string }) {
    const status = input.status === 'online' ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE
    const lastSeenAt = new Date(input.timestamp)
    const updated = await this.repo.updateStatus(input.externalId, status, lastSeenAt)
    if (!updated) {
      this.logger.warn(`Status recebido para dispositivo desconhecido: ${input.externalId}`)
      return null
    }
    this.events.emit('device.status-changed', { externalId: input.externalId, status: updated.status, lastSeenAt })
    return updated
  }
}
