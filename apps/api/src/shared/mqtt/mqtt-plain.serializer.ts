import { Serializer } from '@nestjs/microservices'

export class MqttPlainSerializer implements Serializer {
  serialize(packet: { data: unknown }): unknown {
    return packet.data
  }
}
