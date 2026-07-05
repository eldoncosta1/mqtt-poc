import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
