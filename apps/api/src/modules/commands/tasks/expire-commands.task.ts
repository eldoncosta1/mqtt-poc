import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ExpireStaleCommandsUseCase } from '../application/use-cases/expire-stale-commands.use-case'

@Injectable()
export class ExpireCommandsTask {
  private readonly logger = new Logger(ExpireCommandsTask.name)

  constructor(private readonly expireStaleCommands: ExpireStaleCommandsUseCase) {}

  @Interval(Number(process.env.MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS ?? '10000'))
  async handleInterval() {
    const timeoutMs = Number(process.env.MQTT_COMMAND_TIMEOUT_MS ?? '60000')
    const expired = await this.expireStaleCommands.execute(timeoutMs)
    if (expired.length > 0) {
      this.logger.log(`${expired.length} comando(s) expirado(s) por timeout`)
    }
  }
}
