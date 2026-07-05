export interface MqttConfig {
  url: string
  username?: string
  password?: string
  qos: 0 | 1 | 2
}

export function loadMqttConfig(): MqttConfig {
  const qos = Number(process.env.MQTT_QOS ?? '1')
  if (![0, 1, 2].includes(qos)) {
    throw new Error(`MQTT_QOS inválido: ${process.env.MQTT_QOS}. Deve ser 0, 1 ou 2.`)
  }
  const url = process.env.MQTT_URL
  if (!url) {
    throw new Error('MQTT_URL não configurada')
  }
  return {
    url,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    qos: qos as 0 | 1 | 2,
  }
}
