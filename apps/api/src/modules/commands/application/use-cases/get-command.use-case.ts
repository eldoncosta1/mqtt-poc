import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class GetCommandUseCase {
  constructor(@Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository) {}

  async execute(id: string) {
    const command = await this.repo.findById(id)
    if (!command) throw new NotFoundException('Comando não encontrado')
    return command
  }
}
