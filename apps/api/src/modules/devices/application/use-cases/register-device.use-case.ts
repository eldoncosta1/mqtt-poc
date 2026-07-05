import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class RegisterDeviceUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  async execute(input: { externalId: string; name: string }) {
    const existing = await this.repo.findByExternalId(input.externalId)
    if (existing) throw new ConflictException('Dispositivo com este externalId já cadastrado')
    return this.repo.create(input)
  }
}
