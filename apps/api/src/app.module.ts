import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'

@Module({
  imports: [EventEmitterModule.forRoot(), DevicesModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
