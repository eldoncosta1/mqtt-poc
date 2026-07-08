import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class MarkStaleDevicesOfflineUseCase {
  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(timeoutMs: number) {
    const cutoff = new Date(Date.now() - timeoutMs)
    const affected = await this.repo.markStaleOffline(cutoff)
    for (const device of affected) {
      this.events.emit('device.status-changed', {
        externalId: device.externalId,
        status: device.status,
        lastSeenAt: device.lastSeenAt,
      })
    }
    return affected
  }
}
