import { Serializer, MqttRecord } from '@nestjs/microservices'

export class MqttPlainSerializer implements Serializer {
  serialize(packet: { pattern?: unknown; data: unknown }): unknown {
    if (packet.data instanceof MqttRecord) {
      return { ...(packet.data.data as Record<string, unknown>), options: packet.data.options }
    }
    return packet.data
  }
}
