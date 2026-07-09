import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'
import { CommandsModule } from './modules/commands/commands.module'
import { TelemetryModule } from './modules/telemetry/telemetry.module'
import { RealtimeModule } from './shared/realtime/realtime.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DevicesModule,
    CommandsModule,
    TelemetryModule,
    RealtimeModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
