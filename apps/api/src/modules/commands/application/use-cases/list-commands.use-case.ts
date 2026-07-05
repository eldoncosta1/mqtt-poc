import { Inject, Injectable } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class ListCommandsUseCase {
  constructor(@Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository) {}

  execute(status?: CommandStatus) {
    return this.repo.list(status)
  }
}
