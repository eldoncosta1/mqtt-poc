import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { MarkStaleDevicesOfflineUseCase } from '../application/use-cases/mark-stale-devices-offline.use-case'

@Injectable()
export class DeviceLivenessTask {
  private readonly logger = new Logger(DeviceLivenessTask.name)

  constructor(private readonly markStaleDevicesOffline: MarkStaleDevicesOfflineUseCase) {}

  @Interval(Number(process.env.DEVICE_LIVENESS_CHECK_INTERVAL_MS ?? '10000'))
  async handleInterval() {
    const timeoutMs = Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS ?? '45000')
    const affected = await this.markStaleDevicesOffline.execute(timeoutMs)
    if (affected.length > 0) {
      this.logger.log(`${affected.length} dispositivo(s) marcado(s) OFFLINE por inatividade`)
    }
  }
}
