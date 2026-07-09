import { existsSync } from 'node:fs'

interface LoadEnvDeps {
  existsSync?: (path: string) => boolean
  loadEnvFile?: (path: string) => void
}

// O Node não carrega .env automaticamente; carregamos o .env local se existir,
// para que as variáveis definidas ali (ex.: coordenadas GPS) valham em runtime.
export function loadLocalEnv(deps: LoadEnvDeps = {}): void {
  const fileExists = deps.existsSync ?? existsSync
  const load = deps.loadEnvFile ?? ((path: string) => process.loadEnvFile(path))
  if (fileExists('.env')) load('.env')
}
