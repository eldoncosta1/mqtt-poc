import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { MqttClientModule } from '../../shared/mqtt/mqtt-client.module'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { HandleCommandResponseUseCase } from './application/use-cases/handle-command-response.use-case'
import { CommandsController } from './presentation/controllers/commands.controller'
import { CommandResponsesListener } from './presentation/mqtt/command-responses.listener'

@Module({
  imports: [MqttClientModule],
  providers: [
    PrismaService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
    HandleCommandResponseUseCase,
  ],
  controllers: [CommandsController, CommandResponsesListener],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
