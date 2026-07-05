import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { loadMqttConfig } from './mqtt.config'
import { MqttPublisherService } from './mqtt-publisher.service'

export const MQTT_CLIENT = 'MQTT_CLIENT'

@Module({
  imports: [
    ClientsModule.register([
      {
        name: MQTT_CLIENT,
        transport: Transport.MQTT,
        options: {
          url: loadMqttConfig().url,
          username: loadMqttConfig().username,
          password: loadMqttConfig().password,
          publishOptions: { qos: loadMqttConfig().qos },
        },
      },
    ]),
  ],
  providers: [MqttPublisherService],
  exports: [MqttPublisherService],
})
export class MqttClientModule {}
