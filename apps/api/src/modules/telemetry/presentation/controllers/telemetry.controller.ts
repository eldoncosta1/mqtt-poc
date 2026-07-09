import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ListTelemetryUseCase } from '../../application/use-cases/list-telemetry.use-case'
import { ListTelemetryQueryDto } from '../dtos/list-telemetry-query.dto'

@ApiTags('telemetry')
@Controller('devices')
export class TelemetryController {
  constructor(private readonly listTelemetry: ListTelemetryUseCase) {}

  @Get(':id/telemetry')
  list(@Param('id') id: string, @Query() query: ListTelemetryQueryDto) {
    return this.listTelemetry.execute(id, query.limit ?? 100)
  }
}
