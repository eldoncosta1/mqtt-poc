import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { TELEMETRY_REPOSITORY } from './domain/telemetry.repository'
import { PrismaTelemetryRepository } from './infrastructure/prisma-telemetry.repository'
import { RecordTelemetryUseCase } from './application/use-cases/record-telemetry.use-case'
import { ListTelemetryUseCase } from './application/use-cases/list-telemetry.use-case'
import { TelemetryController } from './presentation/controllers/telemetry.controller'
import { TelemetryListener } from './presentation/mqtt/telemetry.listener'

@Module({
  providers: [
    PrismaService,
    { provide: TELEMETRY_REPOSITORY, useClass: PrismaTelemetryRepository },
    RecordTelemetryUseCase,
    ListTelemetryUseCase,
  ],
  controllers: [TelemetryController, TelemetryListener],
})
export class TelemetryModule {}
