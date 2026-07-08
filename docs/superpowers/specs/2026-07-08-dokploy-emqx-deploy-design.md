# Deploy no Dokploy com EMQX Cloud (broker gerenciado)

**Data:** 2026-07-08
**Objetivo:** subir `api`, `web` e `device-simulator` do `mqtt-poc` num Dokploy já existente, usando um broker MQTT real gerenciado (EMQX Cloud Serverless) com TLS.

## Decisões

| Tema | Decisão |
|---|---|
| Broker | EMQX Cloud **Serverless** (gerenciado, `mqtts://…:8883`, TLS + user/senha) |
| Dokploy | Já instalado num VPS; só criar/configurar os apps |
| Template dos Dockerfiles | Projeto `eben-trace` (mesma stack: monorepo pnpm + NestJS + Prisma) |
| Serviços | `api` + `web` + `device-simulator` (todos em produção) |
| Domínios | Subdomínios separados: `app.<dominio>` (web) e `api.<dominio>` (api) |
| Postgres | Recurso de Database do próprio Dokploy |

## Arquitetura em produção

```
                          Internet
                             │
              ┌──────────────┴───────────────┐
              │      Traefik (Dokploy)        │  TLS/Let's Encrypt
              └───┬───────────────────┬───────┘
         app.<dominio>          api.<dominio>
              │                       │
        ┌─────▼──────┐         ┌──────▼──────┐        ┌──────────────┐
        │ web (nginx)│ HTTP/WS │  api (Nest) │◄──────►│ Postgres      │
        │  :80       │────────►│  :3333      │  Prisma│ (Dokploy DB)  │
        └────────────┘         └──────┬──────┘        └──────────────┘
                                      │ mqtts://…:8883 (TLS + user/pass)
        ┌──────────────┐              │
        │ simulator     │─────────────┤
        │ (device-001)  │              │
        └──────────────┘        ┌──────▼────────┐
                                │ EMQX Cloud     │  broker gerenciado
                                │ Serverless     │
                                └───────────────┘
```

Os 3 apps apontam para o **mesmo repositório Git**, cada um com um Dockerfile diferente na raiz. O build context é sempre a raiz do monorepo.

## Artefatos de código (criados neste repo)

| Arquivo | Papel |
|---|---|
| `Dockerfile.api` | node:22-alpine, pnpm, build shared → `prisma generate` → build api; entrypoint roda migrations; `CMD node apps/api/dist/main.js`; porta 3333 |
| `Dockerfile.web` | multi-stage: build Vite → nginx servindo o `dist`; `VITE_API_URL` como `ARG` (build-time) |
| `Dockerfile.simulator` | build shared → build simulator; `CMD node apps/device-simulator/dist/index.js` |
| `apps/web/nginx.conf` | SPA fallback + cache de assets hasheados |
| `docker-entrypoint.sh` | `pnpm prisma:migrate:deploy` antes de iniciar a API |
| `.dockerignore` | ignora node_modules/dist/.env/docs/compose |
| `package.json` (raiz) | novos scripts `build:shared`, `prisma:generate`, `prisma:migrate:deploy` |

### Notas de implementação (aprendidas na validação)

- **`--ignore-scripts` no install:** o `postinstall` da raiz builda o `@mqtt-poc/shared`, mas no layer do Docker o source do shared ainda não foi copiado no momento do install. Usamos `pnpm install --frozen-lockfile --ignore-scripts` e buildamos shared/prisma explicitamente.
- **`prisma generate` ANTES do `nest build`:** como o `--ignore-scripts` pula o postinstall do `@prisma/client`, o client não é gerado no install. O `nest build` depende dos tipos gerados (`$connect`, models), então `pnpm prisma:generate` roda **antes** do build da API.
- **`DEVICE_EXTERNAL_ID` é obrigatório em produção:** sem ele (e sem `--externalId=`), `loadSimulatorConfig` lança `externalId não configurado` e o container entra em crash-loop. O default `device-001` só existe no script `dev`, não no `start`.
- **CORS REST + WebSocket:** ambos usam a env `WEB_ORIGIN` (`main.ts` e `status.gateway.ts`). Setar `WEB_ORIGIN=https://app.<dominio>` cobre os dois.
- **`VITE_API_URL` é embutido no bundle em build-time** → precisa ser **Build Arg** no Dokploy (não Environment). Se a URL da API mudar, precisa **rebuild** do web.
- **WebSocket via Traefik** funciona nativamente (upgrade automático), sem config extra.

**Status de validação:** as 3 imagens (`api`, `web`, `simulator`) buildam com sucesso localmente via `docker build`. O crash-loop do simulador sem `DEVICE_EXTERNAL_ID` foi confirmado.

## Variáveis de ambiente por serviço

### api (Environment)
```
DATABASE_URL=<connection string interna do Postgres do Dokploy>
PORT=3333
NODE_ENV=production
WEB_ORIGIN=https://app.<dominio>
MQTT_URL=mqtts://<id>.emqxsl.com:8883
MQTT_USERNAME=<user criado no EMQX>
MQTT_PASSWORD=<senha criada no EMQX>
MQTT_QOS=1
MQTT_COMMAND_TIMEOUT_MS=60000
MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS=10000
```

### web (Build Arg — NÃO Environment)
```
VITE_API_URL=https://api.<dominio>
```

### simulator (Environment)
```
MQTT_URL=mqtts://<id>.emqxsl.com:8883
MQTT_USERNAME=<user criado no EMQX>
MQTT_PASSWORD=<senha criada no EMQX>
MQTT_QOS=1
DEVICE_EXTERNAL_ID=device-001
SIMULATOR_RESPONSE_DELAY_MS=1000
SIMULATOR_FAILURE_RATE=0
```

## Passo a passo de configuração

### 1. EMQX Cloud (broker)
1. Criar um deployment **Serverless** no EMQX Cloud.
2. Em **Authentication → Add**, criar uma credencial username/senha para os clientes.
3. Anotar o endereço de conexão: host `…emqxsl.com`, porta TLS `8883` → montar `MQTT_URL=mqtts://<host>:8883`.
4. TLS: o EMQX Serverless usa certificado de CA pública, então o cliente `mqtt` valida com a CA do sistema (sem cert customizado). *Se a validação falhar*, baixar o `emqxsl-ca.crt` e injetar via `NODE_EXTRA_CA_CERTS` — não esperado.

### 2. Código
1. Confirmar que os arquivos abaixo estão no repo e commitados: `Dockerfile.api`, `Dockerfile.web`, `Dockerfile.simulator`, `apps/web/nginx.conf`, `docker-entrypoint.sh`, `.dockerignore`, e os scripts novos no `package.json`.
2. `git push` para o branch que o Dokploy vai observar.

### 3. Dokploy — Postgres
1. Criar um recurso **Database → Postgres** (versão 16).
2. Anotar a connection string **interna** (host = nome do serviço na rede do Dokploy) para o `DATABASE_URL` da API.

### 4. Dokploy — api
1. **Create Application** apontando para o repositório Git + branch.
2. Build Type: **Dockerfile**, path `Dockerfile.api`.
3. **Environment:** variáveis da seção `api` acima.
4. **Domains:** `api.<dominio>`, container port `3333`, HTTPS/Let's Encrypt on.
5. Deploy. O entrypoint roda `prisma migrate deploy` no boot (idempotente).

### 5. Dokploy — web
1. **Create Application** (mesmo repo/branch).
2. Build Type: **Dockerfile**, path `Dockerfile.web`.
3. **Build Args:** `VITE_API_URL=https://api.<dominio>`.
4. **Domains:** `app.<dominio>`, container port `80`, HTTPS/Let's Encrypt on.
5. Deploy.

### 6. Dokploy — simulator
1. **Create Application** (mesmo repo/branch).
2. Build Type: **Dockerfile**, path `Dockerfile.simulator`.
3. **Environment:** variáveis da seção `simulator` acima (⚠️ `DEVICE_EXTERNAL_ID` obrigatório).
4. Sem domínio (não expõe porta).
5. Deploy.

### 7. Verificação
- API: log mostra migrations aplicadas + "API rodando"; `https://api.<dominio>/docs` (Swagger) abre.
- Web: `https://app.<dominio>` carrega e estabelece o WebSocket (sem erro de CORS no console).
- EMQX dashboard: 2 clientes conectados (api + simulator).
- Web: `device-001` aparece com status **ONLINE** e comandos funcionam ponta a ponta.

## Fora de escopo (YAGNI)
- Múltiplos simuladores / réplicas (subir 1 device basta pro POC).
- ACLs finas no EMQX (uma credencial compartilhada é suficiente).
- CI/CD além do deploy por push do próprio Dokploy.
- Broker self-hosted (decidido usar gerenciado).
