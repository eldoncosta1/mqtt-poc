import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { gpsTelemetryMessageSchema } from '@mqtt-poc/shared'
import { RecordTelemetryUseCase } from '../../application/use-cases/record-telemetry.use-case'

@Controller()
export class TelemetryListener {
  private readonly logger = new Logger(TelemetryListener.name)

  constructor(private readonly recordTelemetry: RecordTelemetryUseCase) {}

  @EventPattern('devices/+/telemetry')
  async handleTelemetry(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = gpsTelemetryMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de telemetria inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.recordTelemetry.execute({ externalId, ...parsed.data })
  }
}
