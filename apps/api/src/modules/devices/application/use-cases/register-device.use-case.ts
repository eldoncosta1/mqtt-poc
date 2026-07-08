import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'
import { RetainedStatusReader } from '../../../../shared/mqtt/retained-status-reader'
import { UpdateDeviceStatusUseCase } from './update-device-status.use-case'

@Injectable()
export class RegisterDeviceUseCase {
  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository,
    private readonly retainedStatusReader: RetainedStatusReader,
    private readonly updateDeviceStatus: UpdateDeviceStatusUseCase,
  ) {}

  async execute(input: { externalId: string; name: string }) {
    const existing = await this.repo.findByExternalId(input.externalId)
    if (existing) throw new ConflictException('Dispositivo com este externalId já cadastrado')

    const device = await this.repo.create(input)

    // Reconcilia o status atual: se o dispositivo já estava conectado e publicou um status
    // RETIDO no broker antes deste cadastro, aplica esse estado agora. Sem isso, o "online"
    // retido teria sido descartado pela API (dispositivo ainda não existia) e o registro
    // ficaria preso em UNKNOWN até uma nova reconexão do dispositivo.
    const retained = await this.retainedStatusReader.read(device.externalId)
    if (retained) {
      const updated = await this.updateDeviceStatus.execute({
        externalId: device.externalId,
        status: retained.status,
        timestamp: retained.timestamp,
      })
      return updated ?? device
    }

    return device
  }
}
