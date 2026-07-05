import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { RegisterDeviceUseCase } from '../../application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from '../../application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from '../../application/use-cases/get-device.use-case'
import { RegisterDeviceDto } from '../dtos/register-device.dto'

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly registerDevice: RegisterDeviceUseCase,
    private readonly listDevices: ListDevicesUseCase,
    private readonly getDevice: GetDeviceUseCase,
  ) {}

  @Post()
  create(@Body() dto: RegisterDeviceDto) {
    return this.registerDevice.execute(dto)
  }

  @Get()
  list() {
    return this.listDevices.execute()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getDevice.execute(id)
  }
}
