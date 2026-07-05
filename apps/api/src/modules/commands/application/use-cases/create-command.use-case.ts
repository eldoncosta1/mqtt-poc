import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'
import { MqttPublisherService } from '../../../../shared/mqtt/mqtt-publisher.service'

@Injectable()
export class CreateCommandUseCase {
  private readonly logger = new Logger(CreateCommandUseCase.name)

  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly publisher: MqttPublisherService,
  ) {}

  async execute(input: { deviceId: string; type: string; payload?: unknown }) {
    const device = await this.repo.findDeviceById(input.deviceId)
    if (!device) throw new NotFoundException('Dispositivo não encontrado')

    const command = await this.repo.create(input)

    try {
      await this.publisher.publish(`devices/${device.externalId}/commands`, {
        commandId: command.id,
        type: command.type,
        payload: command.payload,
      })
      return command
    } catch (error) {
      this.logger.error(`Falha ao publicar comando ${command.id} para ${device.externalId}: ${(error as Error).message}`)
      const failed = await this.repo.updateStatus(command.id, { status: CommandStatus.PUBLISH_FAILED })
      return failed ?? command
    }
  }
}
