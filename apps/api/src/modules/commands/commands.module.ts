import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { MqttClientModule } from '../../shared/mqtt/mqtt-client.module'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { CommandsController } from './presentation/controllers/commands.controller'

@Module({
  imports: [MqttClientModule],
  providers: [
    PrismaService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
  ],
  controllers: [CommandsController],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
