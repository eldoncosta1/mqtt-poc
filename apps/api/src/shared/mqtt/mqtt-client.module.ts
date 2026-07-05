import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { loadMqttConfig } from './mqtt.config'
import { MqttPublisherService } from './mqtt-publisher.service'
import { MQTT_CLIENT } from './mqtt-client.token'
import { MqttPlainSerializer } from './mqtt-plain.serializer'

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
              serializer: new MqttPlainSerializer(),
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
