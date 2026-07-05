import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { deviceStatusMessageSchema } from '@mqtt-poc/shared'
import { UpdateDeviceStatusUseCase } from '../../application/use-cases/update-device-status.use-case'

@Controller()
export class DevicesStatusListener {
  private readonly logger = new Logger(DevicesStatusListener.name)

  constructor(private readonly updateDeviceStatus: UpdateDeviceStatusUseCase) {}

  @EventPattern('devices/+/status')
  async handleStatus(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = deviceStatusMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de status inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.updateDeviceStatus.execute({ externalId, ...parsed.data })
  }
}
