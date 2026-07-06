import { Inject, Injectable } from '@nestjs/common'
import { ClientProxy, MqttRecordBuilder } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { MQTT_CLIENT } from './mqtt-client.token'
import { loadMqttConfig } from './mqtt.config'

@Injectable()
export class MqttPublisherService {
  constructor(@Inject(MQTT_CLIENT) private readonly client: ClientProxy) {}

  async publish(topic: string, payload: unknown): Promise<void> {
    const { qos } = loadMqttConfig()
    const record = new MqttRecordBuilder(payload).setQoS(qos).build()
    await firstValueFrom(this.client.emit(topic, record))
  }
}
