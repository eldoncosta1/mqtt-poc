# MQTT Device Commands — Design

**Data:** 2026-07-05
**Status:** Aprovado para planejamento

## Contexto e objetivo

Construir uma aplicação completa de comandos bidirecionais para dispositivos via MQTT, usando NestJS (seguindo a [documentação oficial de microservices MQTT](https://docs.nestjs.com/microservices/mqtt)) e um broker MQTT online (EMQX Cloud Serverless). A aplicação permite que um operador (via frontend web) envie comandos a um dispositivo e acompanhe, em tempo real, o status de entrega/resposta desse comando.

Segue os padrões arquiteturais já estabelecidos nos projetos `eben-aba` e `eben-trace`: monorepo pnpm, Clean Architecture por módulo (domain/application/infrastructure/presentation), Prisma + Postgres, testes com Vitest colocalizados.

Sem autenticação nesta fase (POC interno, poderá ser adicionada depois seguindo o mesmo padrão JWT + roles dos outros projetos).

## Arquitetura geral e layout do monorepo

```
mqtt-poc/
├── apps/
│   ├── api/                  # NestJS hybrid app (REST + MQTT microservice + WebSocket)
│   ├── web/                  # React (Vite) — lista dispositivos, envia comandos, status em tempo real
│   └── device-simulator/     # Script Node/ts standalone — simula um dispositivo real no broker
├── packages/
│   └── shared/                # Tipos e schemas Zod compartilhados (Device, Command, payloads MQTT)
├── prisma/
│   └── schema.prisma
├── docker-compose.yml        # Postgres local + Mosquitto local (dev/testes de integração)
├── pnpm-workspace.yaml
├── vitest.config.ts
├── vitest.config.integration.ts
└── package.json
```

**Broker local vs. broker de nuvem:** dev local e testes de integração usam Postgres + Mosquitto subidos via `docker-compose.yml`, para não depender de credenciais de nuvem sempre disponíveis. Em staging/produção, as mesmas variáveis de ambiente apontam para o EMQX Cloud (host, porta 8883/TLS, usuário/senha). O código de integração com o broker é o mesmo em ambos os casos — só muda a configuração via env vars.

## Integração MQTT: abordagem escolhida

**Hybrid Application com o transporte de microservice MQTT nativo do Nest.** A mesma aplicação Nest expõe REST normalmente e também conecta um microservice com `Transport.MQTT` (`app.connectMicroservice()` + `app.startAllMicroservices()`).

- **Publicação de comandos:** via `ClientProxy.emit(topic, payload)` — fire-and-forget, compatível com o modelo assíncrono de resposta do dispositivo.
- **Recepção de respostas/status:** via `@EventPattern('devices/+/responses')` e `@EventPattern('devices/+/status')` em controllers dedicados — o `+` de wildcard MQTT é suportado nativamente pelo transporte do Nest.
- **Por que não `@MessagePattern` (request/response):** o mecanismo de correlationId automático do Nest é pensado para RPC síncrono. Aqui a correlação entre comando e resposta é feita manualmente via `commandId` embutido no payload (ver seção de contratos), já que a resposta chega de forma assíncrona e desacoplada, possivelmente em um processo/tempo diferente.

Alternativas consideradas e descartadas: um wrapper próprio sobre `mqtt.js` (mais controle, mas reimplementa o que o Nest já oferece) e uma abordagem híbrida (publicar via Nest, assinar via `mqtt.js` puro) — desnecessárias, já que os `@EventPattern` com wildcard cobrem também o caso de status via LWT/retained.

## Modelo de domínio (Prisma schema)

```prisma
enum DeviceStatus {
  ONLINE   // dispositivo publicou status "online" (ou LWT connect) recentemente
  OFFLINE  // broker publicou a mensagem de LWT (Last Will) indicando desconexão
  UNKNOWN  // ainda não recebemos nenhuma mensagem de status deste dispositivo
}

enum CommandStatus {
  PENDING        // comando criado e publicado com sucesso, aguardando resposta do dispositivo
  ACKED          // dispositivo respondeu confirmando execução do comando
  FAILED         // dispositivo respondeu indicando falha ao executar o comando
  PUBLISH_FAILED // a publicação da mensagem no broker falhou (nunca saiu da API)
  TIMEOUT        // nenhuma resposta chegou dentro do prazo configurado (MQTT_COMMAND_TIMEOUT_MS)
}

model Device {
  id         String       @id @default(uuid())     // identificador interno (uuid), usado nas rotas REST
  externalId String       @unique                  // identificador físico do dispositivo (serial/MAC), usado nos tópicos MQTT
  name       String                                 // nome amigável exibido no frontend
  status     DeviceStatus @default(UNKNOWN)          // status atual, atualizado via tópico devices/{externalId}/status
  lastSeenAt DateTime?                               // timestamp da última mensagem de status recebida do dispositivo
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  commands Command[]

  @@index([status])
}

model Command {
  id          String        @id @default(uuid())    // identificador do comando, também usado como commandId de correlação no payload MQTT
  deviceId    String                                 // FK interna para Device.id
  type        String                                 // tipo do comando, livre (ex: "REBOOT", "SET_CONFIG")
  payload     Json?                                  // dados adicionais do comando, formato livre por tipo
  status      CommandStatus @default(PENDING)         // ciclo de vida do comando
  response    Json?                                  // payload de resposta enviado pelo dispositivo, quando houver
  createdAt   DateTime      @default(now())
  respondedAt DateTime?                               // preenchido quando a resposta do dispositivo é processada, ou quando expira por timeout

  device Device @relation(fields: [deviceId], references: [id])

  @@index([deviceId])
  @@index([status])
}
```

`Device.externalId` é desacoplado do `id` interno (uuid) especificamente para ser o identificador usado nos tópicos MQTT, permitindo trocar/reemitir um dispositivo sem herdar o `id` de outro registro.

## Tópicos MQTT e contratos de mensagem

| Tópico | Direção | Publicado por | Consumido por |
|---|---|---|---|
| `devices/{externalId}/commands` | API → dispositivo | API (`ClientProxy.emit`) | Dispositivo / simulador |
| `devices/{externalId}/responses` | dispositivo → API | Dispositivo / simulador | API (`@EventPattern('devices/+/responses')`) |
| `devices/{externalId}/status` | dispositivo → API | Dispositivo / simulador (retained + LWT) | API (`@EventPattern('devices/+/status')`) |

Contratos definidos em `packages/shared` com Zod, reaproveitados por `api`, `web` e `device-simulator`:

```typescript
// devices/{externalId}/commands — API publica
interface CommandMessage {
  commandId: string   // == Command.id, usado como correlação
  type: string
  payload?: unknown
}

// devices/{externalId}/responses — dispositivo publica
interface CommandResponseMessage {
  commandId: string
  status: 'ACKED' | 'FAILED'
  payload?: unknown
}

// devices/{externalId}/status — dispositivo publica (retained)
interface DeviceStatusMessage {
  status: 'online' | 'offline'
  timestamp: string   // ISO 8601
}
```

**Correlação:** o listener de `devices/+/responses` extrai `externalId` do tópico (via `@Payload()`/`@Ctx()`) e `commandId` do corpo da mensagem para localizar o `Command` correspondente no banco.

**LWT (Last Will and Testament):** o dispositivo/simulador configura, ao conectar, uma mensagem de last will em `devices/{externalId}/status` com `{status: 'offline', timestamp}`. O broker publica essa mensagem automaticamente se a conexão cair sem um disconnect gracioso. Configuração do cliente MQTT do dispositivo, não da API.

**QoS configurável:** nível de QoS usado tanto para publish de comandos quanto para subscribe de respostas/status é controlado pela env var `MQTT_QOS` (`0`, `1` ou `2`; default `1`), validada no bootstrap. QoS 1 garante que o broker confirme o recebimento da mensagem (não garante que o dispositivo processou, mas reduz bastante perda silenciosa entre API e broker) sem exigir a complexidade de um mecanismo de timeout/retry completo.

## Estrutura de módulos (Clean Architecture)

```
apps/api/src/
├── modules/
│   ├── devices/
│   │   ├── domain/
│   │   │   └── devices.repository.ts          # interface + DEVICES_REPOSITORY token
│   │   ├── application/use-cases/
│   │   │   ├── register-device.use-case.ts     (+ .spec.ts)
│   │   │   ├── list-devices.use-case.ts        (+ .spec.ts)
│   │   │   ├── get-device.use-case.ts          (+ .spec.ts)
│   │   │   └── update-device-status.use-case.ts (+ .spec.ts)   # chamado pelo listener MQTT de status
│   │   ├── infrastructure/
│   │   │   └── prisma-devices.repository.ts
│   │   ├── presentation/
│   │   │   ├── controllers/devices.controller.ts   # REST: POST/GET devices
│   │   │   ├── mqtt/devices-status.listener.ts      # @EventPattern('devices/+/status')
│   │   │   └── dtos/register-device.dto.ts
│   │   └── devices.module.ts
│   │
│   └── commands/
│       ├── domain/
│       │   └── commands.repository.ts          # interface + COMMANDS_REPOSITORY token
│       ├── application/use-cases/
│       │   ├── create-command.use-case.ts        (+ .spec.ts)   # cria no banco + publica no MQTT
│       │   ├── list-commands.use-case.ts          (+ .spec.ts)
│       │   ├── get-command.use-case.ts            (+ .spec.ts)
│       │   ├── handle-command-response.use-case.ts (+ .spec.ts) # chamado pelo listener MQTT de resposta
│       │   └── expire-stale-commands.use-case.ts   (+ .spec.ts) # chamado pela task agendada
│       ├── infrastructure/
│       │   └── prisma-commands.repository.ts
│       ├── presentation/
│       │   ├── controllers/commands.controller.ts   # REST: POST/GET commands
│       │   ├── mqtt/command-responses.listener.ts    # @EventPattern('devices/+/responses')
│       │   └── dtos/create-command.dto.ts
│       ├── tasks/
│       │   └── expire-commands.task.ts               # @Interval, dispara expire-stale-commands.use-case
│       └── commands.module.ts
│
├── shared/
│   ├── mqtt/
│   │   ├── mqtt-client.module.ts    # ClientsModule.register(Transport.MQTT, envs incl. MQTT_QOS)
│   │   └── mqtt-publisher.service.ts # wrapper fino sobre ClientProxy.emit(), usado pelos use-cases
│   ├── realtime/
│   │   └── status.gateway.ts        # WebSocket Gateway
│   └── prisma/
│       └── prisma.service.ts
├── app.module.ts
└── main.ts                          # NestFactory.create + connectMicroservice(MQTT) + startAllMicroservices
```

Os listeners MQTT (`presentation/mqtt/*.listener.ts`) são `@Controller()` do Nest com `@EventPattern(...)`, chamando o use-case correspondente — exatamente como um controller REST chama um use-case, só que disparado por mensagem em vez de HTTP.

## Tempo real (WebSocket)

`shared/realtime/status.gateway.ts` — `@WebSocketGateway()` (Socket.IO), sem autenticação:

- **Rooms por dispositivo:** o frontend faz `socket.emit('subscribe:device', externalId)` ao abrir a tela de detalhe de um dispositivo, entrando na room `device:{externalId}`.
- **Eventos emitidos pelo servidor:**
  - `command:updated` — `{ commandId, status, response, respondedAt }`
  - `device:status` — `{ externalId, status, lastSeenAt }`
- **Desacoplamento:** os use-cases não conhecem o Gateway diretamente. Eles emitem eventos internos via `EventEmitter2` (`@nestjs/event-emitter`) — `command.updated` / `device.status-changed`. O `StatusGateway` escuta esses eventos com `@OnEvent(...)` e repassa via socket para a room certa, mantendo `application` desacoplado de `presentation`/WebSocket.

## Simulador de dispositivo

`apps/device-simulator/` — script Node/TS standalone (não é um app Nest), usando `mqtt.js` diretamente e os tipos de `packages/shared`.

1. Lê config via env vars (`MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS`, `DEVICE_EXTERNAL_ID`) — mesmas variáveis usadas pela API, apontando tanto para o Mosquitto local quanto para o EMQX Cloud.
2. Ao conectar, configura LWT em `devices/{externalId}/status` (`{status: 'offline', timestamp}`) e publica (retained) `{status: 'online', timestamp}` assim que a conexão é confirmada.
3. Assina `devices/{externalId}/commands`.
4. Ao receber um comando, aguarda um delay simulado configurável (ex: 500ms–2s) e publica em `devices/{externalId}/responses` um `CommandResponseMessage` com `status: 'ACKED'` (ou `'FAILED'` configurável/aleatório, para exercitar os dois caminhos).
5. Loga cada comando recebido e resposta enviada no stdout.

Uso: `pnpm --filter device-simulator start -- --externalId=device-001`, permitindo múltiplas instâncias (um processo por dispositivo simulado) apontando para o mesmo broker.

## Tratamento de erros

| Cenário | Tratamento |
|---|---|
| Dispositivo (`externalId`) não existe ao criar comando | `NotFoundException` (404) no `create-command.use-case`, antes de publicar no MQTT |
| DTO de entrada inválido (REST) | `ValidationPipe` global (`class-validator`), 400 automático |
| Mensagem MQTT de resposta/status malformada (não bate com o schema Zod) | Listener valida com `safeParse`; se inválido, loga `warn` com o payload bruto e descarta — nunca lança exceção não tratada dentro do listener (evitaria derrubar a conexão do microservice) |
| `commandId` em uma resposta não corresponde a nenhum `Command` conhecido | `handle-command-response.use-case` loga `warn` e retorna silenciosamente (idempotente — pode acontecer com reentrega do broker) |
| Conexão com o broker cai | Reconexão automática do `mqtt.js`/transporte do Nest; logs de conexão/desconexão via `Logger` do Nest |
| Falha ao publicar comando no MQTT (broker indisponível/erro de rede) | Ver "Falha de publicação — rastreabilidade" abaixo |
| Comando nunca respondido pelo dispositivo | Ver "Expiração de comandos (timeout)" abaixo |

### Falha de publicação — rastreabilidade

`ClientProxy.emit()` retorna um `Observable` que só dispara a publicação quando alguém se inscreve (`firstValueFrom`/`lastValueFrom`) — se o use-case não aguardar isso, a mensagem pode nunca sair silenciosamente. Para evitar isso e tornar a falha rastreável:

1. `create-command.use-case` persiste o `Command` como `PENDING`.
2. Aguarda (`await firstValueFrom(...)`) a publicação via `MqttPublisherService`.
3. Se falhar, captura o erro, atualiza o `Command` para `PUBLISH_FAILED` e loga estruturado (`commandId`, `deviceId`, `externalId`, tópico, mensagem de erro) via `Logger`.
4. A resposta HTTP do `POST /commands` continua `201` (o recurso foi criado), mas o corpo retorna `status: "PUBLISH_FAILED"` imediatamente — o chamador sabe na hora, sem precisar dar poll. Também consultável depois via `GET /commands?status=PUBLISH_FAILED`.

### Expiração de comandos (timeout)

Comandos publicados com sucesso mas nunca respondidos ficariam `PENDING` para sempre sem esse mecanismo. Implementação:

- `CommandStatus.TIMEOUT` no enum.
- Env var `MQTT_COMMAND_TIMEOUT_MS` define o prazo.
- `expire-commands.task.ts` usa `@nestjs/schedule` (`@Interval(...)`, frequência definida por `MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS`) para periodicamente disparar `ExpireStaleCommandsUseCase`.
- `ExpireStaleCommandsUseCase` chama `PrismaCommandsRepository.expireStalePending(cutoff)`, que retorna os comandos efetivamente expirados nesta execução, e emite `command.updated` (via `EventEmitter2`) para cada um — a UI recebe a atualização em tempo real como qualquer outra mudança de status.

**Idempotência (evitar duplicidade entre múltiplas instâncias da API):** `expireStalePending` executa um único `UPDATE` atômico com `RETURNING`, via `prisma.$queryRaw` (a API `updateMany` do Prisma Client não suporta `RETURNING`):

```sql
UPDATE "Command"
SET status = 'TIMEOUT', "respondedAt" = now()
WHERE status = 'PENDING' AND "createdAt" < $cutoff
RETURNING id, "deviceId"
```

O Postgres bloqueia as linhas casadas pelo `WHERE` durante o `UPDATE`. Se duas instâncias rodarem essa query quase simultaneamente, a segunda só prossegue depois que a primeira commitar — e nesse ponto o `status` das linhas já mudou, então o `WHERE` da segunda não casa mais com elas. O `RETURNING` só devolve as linhas que aquela execução específica de fato mudou. Resultado: cada comando expirado é processado (e o evento emitido) exatamente uma vez, mesmo com múltiplas instâncias rodando o job — sem precisar de lock distribuído (Redis, advisory lock, etc.).

**Limitação aceita conscientemente:** mesmo com o timeout, `PENDING` continua sendo ambíguo até o prazo expirar — a diferença é que agora existe um teto de tempo garantido para essa ambiguidade, em vez de indefinido.

## Estratégia de testes

**Unitários (`*.spec.ts`, colocalizados, dependências mockadas):**
- Cada use-case (`create-command`, `handle-command-response`, `expire-stale-commands`, `update-device-status`, etc.) com repositório mockado — mesmo padrão do `create-case.use-case.spec.ts` do eben-aba.
- `MqttPublisherService`: valida uso do QoS configurado e propagação de erro (caminho `PUBLISH_FAILED`).
- Listeners MQTT: payload malformado é descartado com log; payload válido chama o use-case certo com dados extraídos do tópico.
- `StatusGateway`: eventos internos (`command.updated`, `device.status-changed`) resultam na emissão correta pro room certo (mock do server Socket.IO).

**Integração (`*.integration.spec.ts`, `vitest.config.integration.ts`, timeout maior):**
- Postgres real + Mosquitto local real (docker-compose) — fluxo completo: `POST /commands` → mensagem publicada no Mosquitto → cliente MQTT de teste simula o dispositivo respondendo → valida atualização do `Command` no banco.
- Expiração: cria `Command` com `createdAt` no passado, roda `expireStalePending` diretamente (sem esperar `@Interval`), valida transição para `TIMEOUT` e que executar duas vezes seguidas só afeta a linha uma vez (idempotência).
- Status via LWT: cliente MQTT de teste com LWT configurado, força desconexão abrupta, valida que a API recebe `offline` e atualiza `Device.status`.

**Fora de escopo para teste automatizado:** `apps/web` e `apps/device-simulator` — verificação manual, consistente com os outros projetos (cobertura de testes concentrada na API).

## Diagrama de arquitetura e fluxo de comunicação

```mermaid
flowchart TB
    subgraph Client["apps/web (React)"]
        UI[Interface do operador]
        WS_Client[Socket.IO client]
    end

    subgraph API["apps/api (NestJS Hybrid App)"]
        REST[Controllers REST\ndevices / commands]
        UC_Create[CreateCommandUseCase]
        UC_Response[HandleCommandResponseUseCase]
        UC_Status[UpdateDeviceStatusUseCase]
        UC_Expire[ExpireStaleCommandsUseCase]
        Task[expire-commands.task\n@Interval]
        Publisher[MqttPublisherService\nClientProxy.emit]
        ListenerResp["@EventPattern\ndevices/+/responses"]
        ListenerStatus["@EventPattern\ndevices/+/status"]
        Gateway[StatusGateway\nWebSocket]
        EventBus[(EventEmitter2)]
        DB[(Postgres via Prisma)]
    end

    subgraph Broker["Broker MQTT"]
        Mosquitto[Mosquitto local\ndev/integração]
        EMQX[EMQX Cloud\nstaging/produção]
    end

    subgraph Device["Dispositivo"]
        Sim[apps/device-simulator\nou dispositivo real]
    end

    UI -->|POST /commands| REST
    REST --> UC_Create
    UC_Create -->|persiste PENDING/PUBLISH_FAILED| DB
    UC_Create --> Publisher
    Publisher -->|publish devices/id/commands\nQoS configurável| Broker
    Broker --> Sim

    Sim -->|publish devices/id/responses| Broker
    Broker --> ListenerResp
    ListenerResp --> UC_Response
    UC_Response -->|atualiza status/response| DB
    UC_Response --> EventBus

    Sim -->|publish devices/id/status\nretained + LWT| Broker
    Broker --> ListenerStatus
    ListenerStatus --> UC_Status
    UC_Status -->|atualiza status/lastSeenAt| DB
    UC_Status --> EventBus

    Task -->|dispara periodicamente| UC_Expire
    UC_Expire -->|UPDATE...RETURNING atômico| DB
    UC_Expire --> EventBus

    EventBus -->|command.updated / device.status-changed| Gateway
    Gateway -->|emit para room device:id| WS_Client
    WS_Client --> UI

    REST -->|GET /commands, /devices| DB
```

## Configuração / variáveis de ambiente

| Variável | Descrição | Onde é usada |
|---|---|---|
| `DATABASE_URL` | Conexão Postgres | api |
| `MQTT_URL` | URL do broker (ex: `mqtts://host:8883` para EMQX Cloud, `mqtt://localhost:1883` para Mosquitto local) | api, device-simulator |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Credenciais do broker | api, device-simulator |
| `MQTT_QOS` | Nível de QoS (`0`, `1` ou `2`; default `1`) | api, device-simulator |
| `MQTT_COMMAND_TIMEOUT_MS` | Prazo para expirar comandos `PENDING` sem resposta | api |
| `MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS` | Frequência do job que verifica/expira comandos `PENDING` vencidos | api |
| `DEVICE_EXTERNAL_ID` | Identificador do dispositivo simulado | device-simulator |
| `WEB_ORIGIN` | Origem CORS permitida | api |
| `PORT` | Porta HTTP da API | api |

## Fora de escopo (decisões conscientes)

- Autenticação/autorização (JWT, roles) — pode ser adicionada depois seguindo o mesmo padrão dos outros projetos.
- Retentativa automática de comandos `PUBLISH_FAILED` ou `TIMEOUT` — fica visível/consultável, mas o reenvio é manual por enquanto.
- Testes automatizados de `apps/web` e `apps/device-simulator`.
