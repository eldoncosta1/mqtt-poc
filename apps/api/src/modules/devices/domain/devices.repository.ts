import { Device, DeviceStatus } from '@prisma/client'

export interface DevicesRepository {
  create(data: { externalId: string; name: string }): Promise<Device>
  findById(id: string): Promise<Device | null>
  findByExternalId(externalId: string): Promise<Device | null>
  list(): Promise<Device[]>
  updateStatus(externalId: string, status: DeviceStatus, lastSeenAt: Date): Promise<Device | null>
}

export const DEVICES_REPOSITORY = Symbol('DEVICES_REPOSITORY')
