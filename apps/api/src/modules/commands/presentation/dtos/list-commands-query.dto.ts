import { IsEnum, IsOptional } from 'class-validator'
import { CommandStatus } from '@prisma/client'

export class ListCommandsQueryDto {
  @IsOptional()
  @IsEnum(CommandStatus)
  status?: CommandStatus
}
