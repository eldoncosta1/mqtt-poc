import { Transport, MicroserviceOptions } from '@nestjs/microservices'
import { loadMqttConfig } from './mqtt.config'

export function createMqttMicroserviceOptions(): MicroserviceOptions {
  const config = loadMqttConfig()
  return {
    transport: Transport.MQTT,
    options: {
      url: config.url,
      username: config.username,
      password: config.password,
      subscribeOptions: { qos: config.qos },
    },
  }
}
