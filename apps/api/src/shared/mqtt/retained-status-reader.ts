import { Injectable, Logger } from '@nestjs/common'
import mqtt from 'mqtt'
import { deviceStatusMessageSchema, DeviceStatusMessage } from '@mqtt-poc/shared'
import { loadMqttConfig } from './mqtt.config'

/**
 * Lê a mensagem de status RETIDA de um dispositivo no broker — o "estado corrente" que o
 * MQTT guarda justamente para quem se conecta/pergunta depois. Usado no cadastro para
 * reconciliar o status de um dispositivo que já estava online antes de ser cadastrado
 * (assim a ordem "subir o dispositivo antes de cadastrar" não deixa o registro em UNKNOWN).
 *
 * Abre um cliente MQTT dedicado e de vida curta (uma única tentativa de conexão), assina o
 * tópico de status do dispositivo, e resolve com a mensagem retida se ela chegar dentro do
 * timeout. Resolve `null` se não houver status retido, em payload inválido, ou em qualquer
 * erro — nunca lança, para nunca fazer o cadastro falhar.
 */
@Injectable()
export class RetainedStatusReader {
  private readonly logger = new Logger(RetainedStatusReader.name)

  async read(externalId: string): Promise<DeviceStatusMessage | null> {
    const config = loadMqttConfig()
    const topic = `devices/${externalId}/status`
    const timeoutMs = Number(process.env.MQTT_RETAINED_READ_TIMEOUT_MS ?? '800')

    return new Promise((resolve) => {
      const client = mqtt.connect(config.url, {
        username: config.username,
        password: config.password,
        reconnectPeriod: 0, // uma tentativa só — não ficar reconectando
      })

      let settled = false
      const finish = (result: DeviceStatusMessage | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.end(true)
        resolve(result)
      }

      const timer = setTimeout(() => finish(null), timeoutMs)

      client.on('connect', () => {
        client.subscribe(topic, { qos: config.qos }, (err) => {
          if (err) finish(null)
        })
      })

      client.on('message', (_topic, payload) => {
        let json: unknown
        try {
          json = JSON.parse(payload.toString())
        } catch {
          finish(null)
          return
        }
        const parsed = deviceStatusMessageSchema.safeParse(json)
        finish(parsed.success ? parsed.data : null)
      })

      client.on('error', (err) => {
        this.logger.warn(`Falha ao ler status retido de ${externalId}: ${err.message}`)
        finish(null)
      })
    })
  }
}
