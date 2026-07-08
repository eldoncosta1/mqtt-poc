import mqtt from 'mqtt'
import { loadSimulatorConfig } from './config'
import { DeviceSimulator, buildConnectOptions } from './simulator'

function main(): void {
  const config = loadSimulatorConfig(process.env, process.argv.slice(2))
  console.log(`[simulator] iniciando dispositivo ${config.externalId} -> ${config.url} (qos ${config.qos})`)

  const client = mqtt.connect(config.url, buildConnectOptions(config))
  const simulator = new DeviceSimulator(config, client)
  simulator.start()

  const shutdown = () => {
    console.log('[simulator] encerrando...')
    const fallback = setTimeout(() => process.exit(0), 2000)
    simulator.stop(() => {
      clearTimeout(fallback)
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
