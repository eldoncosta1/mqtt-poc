import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { commandResponseMessageSchema } from '@mqtt-poc/shared'
import { HandleCommandResponseUseCase } from '../../application/use-cases/handle-command-response.use-case'

@Controller()
export class CommandResponsesListener {
  private readonly logger = new Logger(CommandResponsesListener.name)

  constructor(private readonly handleCommandResponse: HandleCommandResponseUseCase) {}

  @EventPattern('devices/+/responses')
  async handleResponse(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = commandResponseMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de resposta inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.handleCommandResponse.execute({ externalId, ...parsed.data })
  }
}
