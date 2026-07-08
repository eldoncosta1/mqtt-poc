export interface SimulatorConfig {
  url: string
  username?: string
  password?: string
  qos: 0 | 1 | 2
  externalId: string
  responseDelayMs: number
  failureRate: number
  heartbeatMs: number
  gpsEnabled: boolean
  gpsIntervalMs: number
  gpsStartLat: number
  gpsStartLon: number
  gpsStepDeg: number
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

  const heartbeatMs = Number(env.SIMULATOR_HEARTBEAT_MS ?? '15000')
  if (Number.isNaN(heartbeatMs) || heartbeatMs < 0) {
    throw new Error(`SIMULATOR_HEARTBEAT_MS inválido: ${env.SIMULATOR_HEARTBEAT_MS}. Deve ser >= 0 (0 desliga o heartbeat).`)
  }

  const gpsEnabled = (env.SIMULATOR_GPS_ENABLED ?? 'true') !== 'false'

  const gpsIntervalMs = Number(env.SIMULATOR_GPS_INTERVAL_MS ?? '3000')
  if (Number.isNaN(gpsIntervalMs) || gpsIntervalMs < 0) {
    throw new Error(`SIMULATOR_GPS_INTERVAL_MS inválido: ${env.SIMULATOR_GPS_INTERVAL_MS}. Deve ser >= 0 (0 desliga o GPS).`)
  }

  const gpsStartLat = Number(env.SIMULATOR_GPS_START_LAT ?? '-23.5505')
  const gpsStartLon = Number(env.SIMULATOR_GPS_START_LON ?? '-46.6333')
  const gpsStepDeg = Number(env.SIMULATOR_GPS_STEP_DEG ?? '0.0005')

  return {
    url,
    username: env.MQTT_USERNAME || undefined,
    password: env.MQTT_PASSWORD || undefined,
    qos: qos as 0 | 1 | 2,
    externalId,
    responseDelayMs,
    failureRate,
    heartbeatMs,
    gpsEnabled,
    gpsIntervalMs,
    gpsStartLat,
    gpsStartLon,
    gpsStepDeg,
  }
}
