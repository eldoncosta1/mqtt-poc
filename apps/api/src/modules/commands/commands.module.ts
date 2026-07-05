import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { loadMqttConfig } from '../../shared/mqtt/mqtt.config'
import { MqttPublisherService } from '../../shared/mqtt/mqtt-publisher.service'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { CommandsController } from './presentation/controllers/commands.controller'

const MQTT_CLIENT = 'MQTT_CLIENT'

@Module({
  imports: [
    ClientsModule.register([
      {
        name: MQTT_CLIENT,
        transport: Transport.MQTT,
        options: {
          url: loadMqttConfig().url,
          username: loadMqttConfig().username,
          password: loadMqttConfig().password,
          publishOptions: { qos: loadMqttConfig().qos },
        },
      },
    ]),
  ],
  providers: [
    PrismaService,
    MqttPublisherService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
  ],
  controllers: [CommandsController],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
