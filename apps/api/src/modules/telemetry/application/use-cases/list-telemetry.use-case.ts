import { Inject, Injectable } from '@nestjs/common'
import { TelemetryRepository, TELEMETRY_REPOSITORY } from '../../domain/telemetry.repository'

const MAX_LIMIT = 500

@Injectable()
export class ListTelemetryUseCase {
  constructor(@Inject(TELEMETRY_REPOSITORY) private readonly repo: TelemetryRepository) {}

  execute(deviceId: string, limit: number) {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
    return this.repo.listByDevice(deviceId, capped)
  }
}
