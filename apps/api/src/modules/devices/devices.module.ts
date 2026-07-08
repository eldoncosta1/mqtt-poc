import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { DEVICES_REPOSITORY } from './domain/devices.repository'
import { PrismaDevicesRepository } from './infrastructure/prisma-devices.repository'
import { RetainedStatusReader } from '../../shared/mqtt/retained-status-reader'
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from './application/use-cases/get-device.use-case'
import { UpdateDeviceStatusUseCase } from './application/use-cases/update-device-status.use-case'
import { MarkStaleDevicesOfflineUseCase } from './application/use-cases/mark-stale-devices-offline.use-case'
import { DeviceLivenessTask } from './tasks/device-liveness.task'
import { DevicesController } from './presentation/controllers/devices.controller'
import { DevicesStatusListener } from './presentation/mqtt/devices-status.listener'

@Module({
  providers: [
    PrismaService,
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    RetainedStatusReader,
    RegisterDeviceUseCase,
    ListDevicesUseCase,
    GetDeviceUseCase,
    UpdateDeviceStatusUseCase,
    MarkStaleDevicesOfflineUseCase,
    DeviceLivenessTask,
  ],
  controllers: [DevicesController, DevicesStatusListener],
  exports: [DEVICES_REPOSITORY, RegisterDeviceUseCase, ListDevicesUseCase, GetDeviceUseCase],
})
export class DevicesModule {}
