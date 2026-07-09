import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TelemetryRepository, TELEMETRY_REPOSITORY } from '../../domain/telemetry.repository'

@Injectable()
export class RecordTelemetryUseCase {
  private readonly logger = new Logger(RecordTelemetryUseCase.name)

  constructor(
    @Inject(TELEMETRY_REPOSITORY) private readonly repo: TelemetryRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; lat: number; lon: number; timestamp: string }): Promise<void> {
    const device = await this.repo.findDeviceByExternalId(input.externalId)
    if (!device) {
      this.logger.warn(`Telemetria recebida para dispositivo não cadastrado: ${input.externalId}`)
      return
    }

    const recordedAt = new Date(input.timestamp)
    await this.repo.create({ deviceId: device.id, lat: input.lat, lon: input.lon, recordedAt })
    this.events.emit('telemetry.recorded', {
      externalId: input.externalId, lat: input.lat, lon: input.lon, recordedAt,
    })
  }
}
