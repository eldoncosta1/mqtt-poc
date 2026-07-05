import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { DEVICES_REPOSITORY } from './domain/devices.repository'
import { PrismaDevicesRepository } from './infrastructure/prisma-devices.repository'
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from './application/use-cases/get-device.use-case'
import { UpdateDeviceStatusUseCase } from './application/use-cases/update-device-status.use-case'
import { DevicesController } from './presentation/controllers/devices.controller'
import { DevicesStatusListener } from './presentation/mqtt/devices-status.listener'

@Module({
  providers: [
    PrismaService,
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    RegisterDeviceUseCase,
    ListDevicesUseCase,
    GetDeviceUseCase,
    UpdateDeviceStatusUseCase,
  ],
  controllers: [DevicesController, DevicesStatusListener],
  exports: [DEVICES_REPOSITORY, RegisterDeviceUseCase, ListDevicesUseCase, GetDeviceUseCase],
})
export class DevicesModule {}
