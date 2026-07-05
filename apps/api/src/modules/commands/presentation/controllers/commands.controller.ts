import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CreateCommandUseCase } from '../../application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from '../../application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from '../../application/use-cases/get-command.use-case'
import { CreateCommandDto } from '../dtos/create-command.dto'
import { ListCommandsQueryDto } from '../dtos/list-commands-query.dto'

@ApiTags('commands')
@Controller('commands')
export class CommandsController {
  constructor(
    private readonly createCommand: CreateCommandUseCase,
    private readonly listCommands: ListCommandsUseCase,
    private readonly getCommand: GetCommandUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateCommandDto) {
    return this.createCommand.execute(dto)
  }

  @Get()
  list(@Query() query: ListCommandsQueryDto) {
    return this.listCommands.execute(query.status)
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getCommand.execute(id)
  }
}
