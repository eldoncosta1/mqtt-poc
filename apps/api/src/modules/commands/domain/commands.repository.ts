import { Command, CommandStatus } from '@prisma/client'

export interface CommandsRepository {
  create(data: { deviceId: string; type: string; payload?: unknown }): Promise<Command>
  updateStatus(id: string, data: { status: CommandStatus; response?: unknown; respondedAt?: Date }): Promise<Command | null>
  findById(id: string): Promise<Command | null>
  list(status?: CommandStatus): Promise<Command[]>
  findDeviceById(deviceId: string): Promise<{ id: string; externalId: string } | null>
  findByDeviceExternalIdAndId(externalId: string, commandId: string): Promise<Command | null>
  expireStalePending(cutoff: Date): Promise<Array<{ id: string; deviceId: string; externalId: string }>>
}

export const COMMANDS_REPOSITORY = Symbol('COMMANDS_REPOSITORY')
