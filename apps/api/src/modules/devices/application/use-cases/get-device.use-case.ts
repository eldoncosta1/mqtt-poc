import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class GetDeviceUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  async execute(id: string) {
    const device = await this.repo.findById(id)
    if (!device) throw new NotFoundException('Dispositivo não encontrado')
    return device
  }
}
