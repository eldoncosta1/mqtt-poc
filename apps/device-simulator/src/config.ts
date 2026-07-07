export interface SimulatorConfig {
  url: string
  username?: string
  password?: string
  qos: 0 | 1 | 2
  externalId: string
  responseDelayMs: number
  failureRate: number
}

function externalIdFromArgv(argv: string[]): string | undefined {
  const arg = argv.find((a) => a.startsWith('--externalId='))
  return arg ? arg.slice('--externalId='.length) : undefined
}

export function loadSimulatorConfig(env: NodeJS.ProcessEnv, argv: string[]): SimulatorConfig {
  const url = env.MQTT_URL
  if (!url) throw new Error('MQTT_URL não configurada')

  const qos = Number(env.MQTT_QOS ?? '1')
  if (![0, 1, 2].includes(qos)) throw new Error(`MQTT_QOS inválido: ${env.MQTT_QOS}. Deve ser 0, 1 ou 2.`)

  const externalId = externalIdFromArgv(argv) ?? env.DEVICE_EXTERNAL_ID
  if (!externalId) throw new Error('externalId não configurado (defina DEVICE_EXTERNAL_ID ou passe --externalId=...)')

  const responseDelayMs = Number(env.SIMULATOR_RESPONSE_DELAY_MS ?? '1000')

  const failureRate = Number(env.SIMULATOR_FAILURE_RATE ?? '0')
  if (Number.isNaN(failureRate) || failureRate < 0 || failureRate > 1) {
    throw new Error(`SIMULATOR_FAILURE_RATE inválido: ${env.SIMULATOR_FAILURE_RATE}. Deve estar entre 0 e 1.`)
  }

  return {
    url,
    username: env.MQTT_USERNAME || undefined,
    password: env.MQTT_PASSWORD || undefined,
    qos: qos as 0 | 1 | 2,
    externalId,
    responseDelayMs,
    failureRate,
  }
}
