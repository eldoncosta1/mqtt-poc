import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class HandleCommandResponseUseCase {
  private readonly logger = new Logger(HandleCommandResponseUseCase.name)

  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; commandId: string; status: 'ACKED' | 'FAILED'; payload?: unknown }) {
    const command = await this.repo.findByDeviceExternalIdAndId(input.externalId, input.commandId)
    if (!command) {
      this.logger.warn(`Resposta recebida para comando desconhecido: ${input.commandId} (dispositivo ${input.externalId})`)
      return null
    }

    const status = input.status === 'ACKED' ? CommandStatus.ACKED : CommandStatus.FAILED
    const updated = await this.repo.updateStatus(command.id, { status, response: input.payload, respondedAt: new Date() })
    if (updated) {
      this.events.emit('command.updated', {
        externalId: input.externalId,
        commandId: updated.id,
        status: updated.status,
        response: updated.response,
        respondedAt: updated.respondedAt,
      })
    }
    return updated
  }
}
