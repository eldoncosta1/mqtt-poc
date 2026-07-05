import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class ExpireStaleCommandsUseCase {
  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(timeoutMs: number) {
    const cutoff = new Date(Date.now() - timeoutMs)
    const expired = await this.repo.expireStalePending(cutoff)
    for (const command of expired) {
      this.events.emit('command.updated', {
        externalId: command.externalId,
        commandId: command.id,
        status: 'TIMEOUT',
        response: null,
        respondedAt: new Date(),
      })
    }
    return expired
  }
}
