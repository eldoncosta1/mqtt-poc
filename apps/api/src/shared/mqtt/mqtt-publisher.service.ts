import { Inject, Injectable } from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { MQTT_CLIENT } from './mqtt-client.token'

@Injectable()
export class MqttPublisherService {
  constructor(@Inject(MQTT_CLIENT) private readonly client: ClientProxy) {}

  async publish(topic: string, payload: unknown): Promise<void> {
    await firstValueFrom(this.client.emit(topic, payload))
  }
}
