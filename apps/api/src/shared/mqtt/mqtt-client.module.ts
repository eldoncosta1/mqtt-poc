import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { loadMqttConfig } from './mqtt.config'
import { MqttPublisherService } from './mqtt-publisher.service'

export const MQTT_CLIENT = 'MQTT_CLIENT'

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MQTT_CLIENT,
        useFactory: () => {
          const config = loadMqttConfig()
          return {
            transport: Transport.MQTT,
            options: {
              url: config.url,
              username: config.username,
              password: config.password,
              publishOptions: { qos: config.qos },
            },
          }
        },
      },
    ]),
  ],
  providers: [MqttPublisherService],
  exports: [MqttPublisherService],
})
export class MqttClientModule {}
