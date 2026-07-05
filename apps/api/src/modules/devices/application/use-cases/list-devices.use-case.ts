import { Inject, Injectable } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class ListDevicesUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  execute() {
    return this.repo.list()
  }
}
