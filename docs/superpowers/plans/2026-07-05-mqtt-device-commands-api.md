# MQTT Device Commands — API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation and the NestJS API (`apps/api`) that lets an operator send commands to a device over MQTT (EMQX Cloud in prod, local Mosquitto in dev/test) and see command/device status update in real time, with Postgres persistence and full test coverage.

**Architecture:** pnpm monorepo (`apps/*`, `packages/*`). NestJS Hybrid Application: REST controllers + an MQTT microservice transport (`@nestjs/microservices`, `Transport.MQTT`) in the same process. Clean Architecture per module (`domain/application/infrastructure/presentation`), Prisma + Postgres for persistence, `@nestjs/event-emitter` to decouple use-cases from a Socket.IO `StatusGateway`, `@nestjs/schedule` for an idempotent command-expiration job.

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL 16, `@nestjs/microservices` + `mqtt` (MQTT transport), `@nestjs/websockets` + `socket.io` (realtime), `@nestjs/event-emitter`, `@nestjs/schedule`, Zod (MQTT payload contracts in `packages/shared`), `class-validator`/`class-transformer` (REST DTOs), Vitest (unit + integration), Docker Compose (Postgres + Mosquitto for dev/test), pnpm workspaces.

This plan corresponds to: `docs/superpowers/specs/2026-07-05-mqtt-device-commands-design.md`. Reference architecture pattern replicated from `eben-aba`/`eben-trace` monorepos.

## Global Constraints

- Node >= 22, pnpm >= 9.15.0 (`packageManager` pinned in root `package.json`).
- TypeScript 5.6, `strict: true` (via `tsconfig.base.json`).
- No authentication in this phase (explicitly out of scope per design doc).
- Unit tests colocated as `*.spec.ts` (Vitest, `globals: true`); integration tests as `*.integration.spec.ts`, run via `vitest.config.integration.ts`, timeout 30s.
- Every module follows `domain/ (repository interface + token) → application/use-cases/ (+ .spec.ts) → infrastructure/ (Prisma repo) → presentation/ (controllers, dtos, mqtt listeners)`.
- `prisma/schema.prisma` enums and models must carry `//` comments on every field/value explaining its purpose (explicit user requirement).
- MQTT topics: `devices/{externalId}/commands` (API → device), `devices/{externalId}/responses` (device → API), `devices/{externalId}/status` (device → API, retained + LWT).
- MQTT QoS is configurable via `MQTT_QOS` env var (`0`, `1`, or `2`; default `1`), applied to both publish and subscribe.
- Command lifecycle: `PENDING → ACKED | FAILED | PUBLISH_FAILED | TIMEOUT`. No retry logic — out of scope.
- Command expiration must be idempotent under concurrent execution via a single atomic `UPDATE ... RETURNING` SQL statement (no distributed locks).
- Cross-entity repository queries follow the reference pattern: a module's repository queries tables it needs directly (e.g. `CommandsRepository.findDeviceById`) instead of injecting another module's repository — avoids cross-module DI coupling.

---

### Task 1: Monorepo Scaffold & Prisma Schema

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `vitest.config.integration.ts`
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Device` and `Command` Prisma models (with `DeviceStatus`, `CommandStatus` enums) — every later task's repositories depend on the exact field names defined here (`Device.id`, `Device.externalId`, `Device.name`, `Device.status`, `Device.lastSeenAt`; `Command.id`, `Command.deviceId`, `Command.type`, `Command.payload`, `Command.status`, `Command.response`, `Command.createdAt`, `Command.respondedAt`).

- [ ] **Step 1: Create root workspace files**

`package.json`:
```json
{
  "name": "mqtt-poc",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22",
    "pnpm": ">=9.15.0"
  },
  "scripts": {
    "dev:api": "pnpm --filter @mqtt-poc/api dev",
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.config.integration.ts",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.8",
    "prisma": "^5.22.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.DS_Store
```

`.env.example`:
```
DATABASE_URL="postgresql://mqtt:mqtt@localhost:5432/mqtt_poc"
PORT=3333
NODE_ENV=development
WEB_ORIGIN="http://localhost:5173"
MQTT_URL="mqtt://localhost:1883"
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_QOS=1
MQTT_COMMAND_TIMEOUT_MS=60000
MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS=10000
```

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts'],
    globals: true,
  },
})
```

`vitest.config.integration.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/**/*.integration.spec.ts'],
    globals: true,
    testTimeout: 30000,
  },
})
```

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mqtt
      POSTGRES_PASSWORD: mqtt
      POSTGRES_DB: mqtt_poc
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mqtt -d mqtt_poc"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Step 2: Create the Prisma schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: completes with no errors (lockfile created/updated).

- [ ] **Step 4: Start Postgres and run the initial migration**

Run:
```bash
cp .env.example .env
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U mqtt -d mqtt_poc; do sleep 1; done
pnpm prisma migrate dev --name init
```
Expected: migration created under `prisma/migrations/`, applied successfully, output ends with `Your database is now in sync with your schema.`

- [ ] **Step 5: Verify the tables exist**

Run: `docker compose exec -T postgres psql -U mqtt -d mqtt_poc -c '\dt'`
Expected: output lists `Device` and `Command` (and `_prisma_migrations`).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example vitest.config.ts vitest.config.integration.ts docker-compose.yml prisma
git commit -m "feat: scaffold monorepo and Prisma schema for device/command models"
```

---

### Task 2: Shared MQTT Message Contracts (`packages/shared`)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas/mqtt.schema.ts`
- Test: `packages/shared/src/schemas/mqtt.schema.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf package).
- Produces: `commandMessageSchema`, `CommandMessage`; `commandResponseMessageSchema`, `CommandResponseMessage`; `deviceStatusMessageSchema`, `DeviceStatusMessage` — imported as `@mqtt-poc/shared` by the API's MQTT listeners (Tasks 6 and 8).

- [ ] **Step 1: Create the package scaffold**

`packages/shared/package.json`:
```json
{
  "name": "@mqtt-poc/shared",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test for the MQTT schemas**

`packages/shared/src/schemas/mqtt.schema.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { commandMessageSchema, commandResponseMessageSchema, deviceStatusMessageSchema } from './mqtt.schema'

describe('commandMessageSchema', () => {
  it('parses a valid command message', () => {
    const result = commandMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'REBOOT',
      payload: { delaySeconds: 5 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a message without commandId', () => {
    const result = commandMessageSchema.safeParse({ type: 'REBOOT' })
    expect(result.success).toBe(false)
  })
})

describe('commandResponseMessageSchema', () => {
  it('parses a valid ACKED response', () => {
    const result = commandResponseMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'ACKED',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status value', () => {
    const result = commandResponseMessageSchema.safeParse({
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'DONE',
    })
    expect(result.success).toBe(false)
  })
})

describe('deviceStatusMessageSchema', () => {
  it('parses a valid online status message', () => {
    const result = deviceStatusMessageSchema.safeParse({
      status: 'online',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing timestamp', () => {
    const result = deviceStatusMessageSchema.safeParse({ status: 'online' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/src/schemas/mqtt.schema.spec.ts`
Expected: FAIL with a module-not-found error for `./mqtt.schema`.

- [ ] **Step 4: Implement the schemas**

`packages/shared/src/schemas/mqtt.schema.ts`:
```typescript
import { z } from 'zod'

export const commandMessageSchema = z.object({
  commandId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown().optional(),
})
export type CommandMessage = z.infer<typeof commandMessageSchema>

export const commandResponseMessageSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(['ACKED', 'FAILED']),
  payload: z.unknown().optional(),
})
export type CommandResponseMessage = z.infer<typeof commandResponseMessageSchema>

export const deviceStatusMessageSchema = z.object({
  status: z.enum(['online', 'offline']),
  timestamp: z.string().datetime(),
})
export type DeviceStatusMessage = z.infer<typeof deviceStatusMessageSchema>
```

`packages/shared/src/index.ts`:
```typescript
export * from './schemas/mqtt.schema'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/src/schemas/mqtt.schema.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared MQTT message contracts (zod schemas)"
```

---

### Task 3: NestJS API Bootstrap

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/shared/prisma/prisma.service.ts`

**Interfaces:**
- Consumes: nothing yet (no other module exists).
- Produces: `PrismaService` (extends `PrismaClient`, connects `onModuleInit`) — every repository in later tasks injects this. `AppModule` — every module (`DevicesModule`, `CommandsModule`, `RealtimeModule`) gets registered in its `imports` array in later tasks.

- [ ] **Step 1: Create the API package scaffold**

`apps/api/package.json`:
```json
{
  "name": "@mqtt-poc/api",
  "version": "0.0.1",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.7",
    "@nestjs/core": "^10.4.7",
    "@nestjs/platform-express": "^10.4.7",
    "@nestjs/platform-socket.io": "^10.4.7",
    "@nestjs/websockets": "^10.4.7",
    "@nestjs/microservices": "^10.4.7",
    "@nestjs/event-emitter": "^2.1.1",
    "@nestjs/schedule": "^4.1.2",
    "@nestjs/swagger": "^8.0.0",
    "@prisma/client": "^5.22.0",
    "@mqtt-poc/shared": "workspace:*",
    "mqtt": "^5.10.1",
    "socket.io": "^4.8.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.1",
    "zod": "^3.23.0",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/testing": "^10.4.7",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  }
}
```

`apps/api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "strictPropertyInitialization": false
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 2: Implement PrismaService**

`apps/api/src/shared/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect()
  }
}
```

- [ ] **Step 3: Implement AppModule and main.ts**

`apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

`apps/api/src/main.ts`:
```typescript
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder().setTitle('MQTT Device Commands API').setVersion('1.0').build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config))

  await app.listen(process.env.PORT ?? 3333)
  console.log(`API rodando em http://localhost:${process.env.PORT ?? 3333}`)
  console.log(`Swagger em http://localhost:${process.env.PORT ?? 3333}/docs`)
}

bootstrap()
```

- [ ] **Step 4: Install and build**

Run: `pnpm install && pnpm --filter @mqtt-poc/api build`
Expected: `nest build` completes with no TypeScript errors, `apps/api/dist/main.js` created.

- [ ] **Step 5: Smoke-test the running app**

Run:
```bash
pnpm --filter @mqtt-poc/api start &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/docs
kill %1
```
Expected: prints `200`.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: bootstrap NestJS API with Swagger and Prisma"
```

---

### Task 4: MQTT Client & Publisher Service

**Files:**
- Create: `apps/api/src/shared/mqtt/mqtt.config.ts`
- Test: `apps/api/src/shared/mqtt/mqtt.config.spec.ts`
- Create: `apps/api/src/shared/mqtt/mqtt-client.module.ts`
- Create: `apps/api/src/shared/mqtt/mqtt-publisher.service.ts`
- Test: `apps/api/src/shared/mqtt/mqtt-publisher.service.spec.ts`

**Interfaces:**
- Consumes: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS` env vars.
- Produces: `loadMqttConfig(): MqttConfig` (`{ url: string; username?: string; password?: string; qos: 0 | 1 | 2 }`) and `MqttPublisherService.publish(topic: string, payload: unknown): Promise<void>` — used by `CreateCommandUseCase` (Task 7). `MQTT_CLIENT` token exported from `mqtt-client.module.ts`.

- [ ] **Step 1: Write the failing test for `loadMqttConfig`**

`apps/api/src/shared/mqtt/mqtt.config.spec.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { loadMqttConfig } from './mqtt.config'

describe('loadMqttConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads a valid configuration with default QoS', () => {
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    delete process.env.MQTT_QOS
    const config = loadMqttConfig()
    expect(config).toEqual({ url: 'mqtt://localhost:1883', username: undefined, password: undefined, qos: 1 })
  })

  it('throws when MQTT_URL is missing', () => {
    delete process.env.MQTT_URL
    expect(() => loadMqttConfig()).toThrow('MQTT_URL não configurada')
  })

  it('throws when MQTT_QOS is not 0, 1 or 2', () => {
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    process.env.MQTT_QOS = '5'
    expect(() => loadMqttConfig()).toThrow('MQTT_QOS inválido')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/shared/mqtt/mqtt.config.spec.ts`
Expected: FAIL, module `./mqtt.config` not found.

- [ ] **Step 3: Implement `loadMqttConfig`**

`apps/api/src/shared/mqtt/mqtt.config.ts`:
```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/shared/mqtt/mqtt.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `MqttPublisherService`**

`apps/api/src/shared/mqtt/mqtt-publisher.service.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { of, throwError } from 'rxjs'
import { MqttPublisherService } from './mqtt-publisher.service'

describe('MqttPublisherService', () => {
  it('emits the payload on the given topic and resolves', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(of(undefined)) }
    const service = new MqttPublisherService(mockClient as any)
    await service.publish('devices/device-1/commands', { commandId: 'c1' })
    expect(mockClient.emit).toHaveBeenCalledWith('devices/device-1/commands', { commandId: 'c1' })
  })

  it('propagates an error when the underlying client fails to publish', async () => {
    const mockClient = { emit: vi.fn().mockReturnValue(throwError(() => new Error('broker unavailable'))) }
    const service = new MqttPublisherService(mockClient as any)
    await expect(service.publish('devices/device-1/commands', {})).rejects.toThrow('broker unavailable')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/shared/mqtt/mqtt-publisher.service.spec.ts`
Expected: FAIL, module `./mqtt-publisher.service` not found.

- [ ] **Step 7: Implement `mqtt-client.module.ts` and `mqtt-publisher.service.ts`**

`apps/api/src/shared/mqtt/mqtt-client.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { loadMqttConfig } from './mqtt.config'
import { MqttPublisherService } from './mqtt-publisher.service'

export const MQTT_CLIENT = 'MQTT_CLIENT'

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
```

`apps/api/src/shared/mqtt/mqtt-publisher.service.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { MQTT_CLIENT } from './mqtt-client.module'

@Injectable()
export class MqttPublisherService {
  constructor(@Inject(MQTT_CLIENT) private readonly client: ClientProxy) {}

  async publish(topic: string, payload: unknown): Promise<void> {
    await firstValueFrom(this.client.emit(topic, payload))
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/shared/mqtt/mqtt-publisher.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/shared/mqtt
git commit -m "feat: add MQTT config loader and publisher service"
```

---

### Task 5: Devices Module (REST)

**Files:**
- Create: `apps/api/src/modules/devices/domain/devices.repository.ts`
- Create: `apps/api/src/modules/devices/infrastructure/prisma-devices.repository.ts`
- Create: `apps/api/src/modules/devices/application/use-cases/register-device.use-case.ts`
- Test: `apps/api/src/modules/devices/application/use-cases/register-device.use-case.spec.ts`
- Create: `apps/api/src/modules/devices/application/use-cases/list-devices.use-case.ts`
- Test: `apps/api/src/modules/devices/application/use-cases/list-devices.use-case.spec.ts`
- Create: `apps/api/src/modules/devices/application/use-cases/get-device.use-case.ts`
- Test: `apps/api/src/modules/devices/application/use-cases/get-device.use-case.spec.ts`
- Create: `apps/api/src/modules/devices/presentation/dtos/register-device.dto.ts`
- Create: `apps/api/src/modules/devices/presentation/controllers/devices.controller.ts`
- Create: `apps/api/src/modules/devices/devices.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3).
- Produces: `DevicesRepository` interface + `DEVICES_REPOSITORY` token (`create`, `findById`, `findByExternalId`, `list`, `updateStatus`) — `updateStatus` is consumed by Task 6's `UpdateDeviceStatusUseCase`. REST routes: `POST /devices`, `GET /devices`, `GET /devices/:id`.

- [ ] **Step 1: Define the repository interface**

`apps/api/src/modules/devices/domain/devices.repository.ts`:
```typescript
import { Device, DeviceStatus } from '@prisma/client'

export interface DevicesRepository {
  create(data: { externalId: string; name: string }): Promise<Device>
  findById(id: string): Promise<Device | null>
  findByExternalId(externalId: string): Promise<Device | null>
  list(): Promise<Device[]>
  updateStatus(externalId: string, status: DeviceStatus, lastSeenAt: Date): Promise<Device | null>
}

export const DEVICES_REPOSITORY = Symbol('DEVICES_REPOSITORY')
```

- [ ] **Step 2: Implement the Prisma repository**

`apps/api/src/modules/devices/infrastructure/prisma-devices.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common'
import { DeviceStatus } from '@prisma/client'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { DevicesRepository } from '../domain/devices.repository'

@Injectable()
export class PrismaDevicesRepository implements DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { externalId: string; name: string }) {
    return this.prisma.device.create({ data })
  }

  findById(id: string) {
    return this.prisma.device.findUnique({ where: { id } })
  }

  findByExternalId(externalId: string) {
    return this.prisma.device.findUnique({ where: { externalId } })
  }

  list() {
    return this.prisma.device.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async updateStatus(externalId: string, status: DeviceStatus, lastSeenAt: Date) {
    try {
      return await this.prisma.device.update({ where: { externalId }, data: { status, lastSeenAt } })
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 3: Write failing use-case tests**

`apps/api/src/modules/devices/application/use-cases/register-device.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException } from '@nestjs/common'
import { RegisterDeviceUseCase } from './register-device.use-case'

const mockRepo = { findByExternalId: vi.fn(), create: vi.fn() }

describe('RegisterDeviceUseCase', () => {
  const useCase = new RegisterDeviceUseCase(mockRepo as any)

  beforeEach(() => vi.clearAllMocks())

  it('registers a new device', async () => {
    mockRepo.findByExternalId.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'd1', externalId: 'device-1', name: 'Sensor 1' })
    const result = await useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })
    expect(result.id).toBe('d1')
    expect(mockRepo.create).toHaveBeenCalledWith({ externalId: 'device-1', name: 'Sensor 1' })
  })

  it('throws ConflictException when externalId already exists', async () => {
    mockRepo.findByExternalId.mockResolvedValue({ id: 'd1' })
    await expect(useCase.execute({ externalId: 'device-1', name: 'Sensor 1' })).rejects.toThrow(ConflictException)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })
})
```

`apps/api/src/modules/devices/application/use-cases/list-devices.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { ListDevicesUseCase } from './list-devices.use-case'

describe('ListDevicesUseCase', () => {
  it('returns all devices from the repository', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]) }
    const useCase = new ListDevicesUseCase(mockRepo as any)
    const result = await useCase.execute()
    expect(result).toHaveLength(2)
  })
})
```

`apps/api/src/modules/devices/application/use-cases/get-device.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { GetDeviceUseCase } from './get-device.use-case'

describe('GetDeviceUseCase', () => {
  it('returns the device when found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: 'd1' }) }
    const useCase = new GetDeviceUseCase(mockRepo as any)
    const result = await useCase.execute('d1')
    expect(result.id).toBe('d1')
  })

  it('throws NotFoundException when device does not exist', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(null) }
    const useCase = new GetDeviceUseCase(mockRepo as any)
    await expect(useCase.execute('unknown')).rejects.toThrow(NotFoundException)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/src/modules/devices`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the use-cases**

`apps/api/src/modules/devices/application/use-cases/register-device.use-case.ts`:
```typescript
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class RegisterDeviceUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  async execute(input: { externalId: string; name: string }) {
    const existing = await this.repo.findByExternalId(input.externalId)
    if (existing) throw new ConflictException('Dispositivo com este externalId já cadastrado')
    return this.repo.create(input)
  }
}
```

`apps/api/src/modules/devices/application/use-cases/list-devices.use-case.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class ListDevicesUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  execute() {
    return this.repo.list()
  }
}
```

`apps/api/src/modules/devices/application/use-cases/get-device.use-case.ts`:
```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class GetDeviceUseCase {
  constructor(@Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository) {}

  async execute(id: string) {
    const device = await this.repo.findById(id)
    if (!device) throw new NotFoundException('Dispositivo não encontrado')
    return device
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/src/modules/devices`
Expected: PASS (5 tests).

- [ ] **Step 7: Add DTO, controller, and module wiring**

`apps/api/src/modules/devices/presentation/dtos/register-device.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator'

export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  externalId: string

  @IsString()
  @MinLength(1)
  name: string
}
```

`apps/api/src/modules/devices/presentation/controllers/devices.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { RegisterDeviceUseCase } from '../../application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from '../../application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from '../../application/use-cases/get-device.use-case'
import { RegisterDeviceDto } from '../dtos/register-device.dto'

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly registerDevice: RegisterDeviceUseCase,
    private readonly listDevices: ListDevicesUseCase,
    private readonly getDevice: GetDeviceUseCase,
  ) {}

  @Post()
  create(@Body() dto: RegisterDeviceDto) {
    return this.registerDevice.execute(dto)
  }

  @Get()
  list() {
    return this.listDevices.execute()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getDevice.execute(id)
  }
}
```

`apps/api/src/modules/devices/devices.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { DEVICES_REPOSITORY } from './domain/devices.repository'
import { PrismaDevicesRepository } from './infrastructure/prisma-devices.repository'
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from './application/use-cases/get-device.use-case'
import { DevicesController } from './presentation/controllers/devices.controller'

@Module({
  providers: [
    PrismaService,
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    RegisterDeviceUseCase,
    ListDevicesUseCase,
    GetDeviceUseCase,
  ],
  controllers: [DevicesController],
  exports: [DEVICES_REPOSITORY, RegisterDeviceUseCase, ListDevicesUseCase, GetDeviceUseCase],
})
export class DevicesModule {}
```

- [ ] **Step 8: Wire `DevicesModule` into `AppModule`**

Modify `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'

@Module({
  imports: [EventEmitterModule.forRoot(), DevicesModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

- [ ] **Step 9: Build and manually verify the REST endpoints**

Run:
```bash
pnpm --filter @mqtt-poc/api build
pnpm --filter @mqtt-poc/api start &
sleep 2
curl -s -X POST http://localhost:3333/devices -H "Content-Type: application/json" -d '{"externalId":"device-001","name":"Sensor de teste"}'
curl -s http://localhost:3333/devices
kill %1
```
Expected: first `curl` returns a JSON device with `status: "UNKNOWN"`; second `curl` returns an array containing it.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/devices apps/api/src/app.module.ts
git commit -m "feat: add devices module with REST CRUD"
```

---

### Task 6: MQTT Microservice Wiring & Device Status Ingestion

**Files:**
- Create: `mosquitto.conf`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Create: `apps/api/src/shared/mqtt/mqtt-microservice-options.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.ts`
- Test: `apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.spec.ts`
- Create: `apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.ts`
- Test: `apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.spec.ts`
- Modify: `apps/api/src/modules/devices/devices.module.ts`

**Interfaces:**
- Consumes: `DevicesRepository.updateStatus` (Task 5), `deviceStatusMessageSchema` (Task 2), `loadMqttConfig` (Task 4).
- Produces: `createMqttMicroserviceOptions(): MicroserviceOptions` — reused by `main.ts` and by Task 11's integration tests. Emits internal event `device.status-changed` with payload `{ externalId: string; status: DeviceStatus; lastSeenAt: Date }`, consumed by Task 9's `StatusGateway`.

- [ ] **Step 1: Add Mosquitto to the local dev stack**

`mosquitto.conf`:
```
listener 1883
allow_anonymous true
```

Modify `docker-compose.yml` (add the `mosquitto` service alongside `postgres`):
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mqtt
      POSTGRES_PASSWORD: mqtt
      POSTGRES_DB: mqtt_poc
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mqtt -d mqtt_poc"]
      interval: 5s
      timeout: 5s
      retries: 5

  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf

volumes:
  postgres_data:
```

Run: `docker compose up -d mosquitto`
Expected: container starts and stays up (`docker compose ps` shows `mosquitto` as `running`).

Modify `.env.example` — confirm these lines are present (already added in Task 1, no change needed):
```
MQTT_URL="mqtt://localhost:1883"
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_QOS=1
```

- [ ] **Step 2: Extract MQTT microservice options into a reusable factory**

`apps/api/src/shared/mqtt/mqtt-microservice-options.ts`:
```typescript
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
```

- [ ] **Step 3: Connect the MQTT microservice in `main.ts`**

Modify `apps/api/src/main.ts`:
```typescript
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { createMqttMicroserviceOptions } from './shared/mqtt/mqtt-microservice-options'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.connectMicroservice(createMqttMicroserviceOptions())

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder().setTitle('MQTT Device Commands API').setVersion('1.0').build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config))

  await app.startAllMicroservices()
  await app.listen(process.env.PORT ?? 3333)
  console.log(`API rodando em http://localhost:${process.env.PORT ?? 3333}`)
  console.log(`Swagger em http://localhost:${process.env.PORT ?? 3333}/docs`)
}

bootstrap()
```

- [ ] **Step 4: Write failing tests for `UpdateDeviceStatusUseCase`**

`apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceStatus } from '@prisma/client'
import { UpdateDeviceStatusUseCase } from './update-device-status.use-case'

const mockRepo = { updateStatus: vi.fn() }
const mockEvents = { emit: vi.fn() }

describe('UpdateDeviceStatusUseCase', () => {
  const useCase = new UpdateDeviceStatusUseCase(mockRepo as any, mockEvents as any)

  beforeEach(() => vi.clearAllMocks())

  it('updates device to ONLINE and emits device.status-changed', async () => {
    const timestamp = '2026-07-05T10:00:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.ONLINE })
    await useCase.execute({ externalId: 'device-1', status: 'online', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.ONLINE, new Date(timestamp))
    expect(mockEvents.emit).toHaveBeenCalledWith('device.status-changed', {
      externalId: 'device-1', status: DeviceStatus.ONLINE, lastSeenAt: new Date(timestamp),
    })
  })

  it('updates device to OFFLINE', async () => {
    const timestamp = '2026-07-05T10:05:00.000Z'
    mockRepo.updateStatus.mockResolvedValue({ id: 'd1', externalId: 'device-1', status: DeviceStatus.OFFLINE })
    await useCase.execute({ externalId: 'device-1', status: 'offline', timestamp })
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('device-1', DeviceStatus.OFFLINE, new Date(timestamp))
  })

  it('returns null and does not emit when device is unknown', async () => {
    mockRepo.updateStatus.mockResolvedValue(null)
    const result = await useCase.execute({ externalId: 'unknown-device', status: 'online', timestamp: '2026-07-05T10:00:00.000Z' })
    expect(result).toBeNull()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 6: Implement `UpdateDeviceStatusUseCase`**

`apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DeviceStatus } from '@prisma/client'
import { DevicesRepository, DEVICES_REPOSITORY } from '../../domain/devices.repository'

@Injectable()
export class UpdateDeviceStatusUseCase {
  private readonly logger = new Logger(UpdateDeviceStatusUseCase.name)

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repo: DevicesRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; status: 'online' | 'offline'; timestamp: string }) {
    const status = input.status === 'online' ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE
    const lastSeenAt = new Date(input.timestamp)
    const updated = await this.repo.updateStatus(input.externalId, status, lastSeenAt)
    if (!updated) {
      this.logger.warn(`Status recebido para dispositivo desconhecido: ${input.externalId}`)
      return null
    }
    this.events.emit('device.status-changed', { externalId: input.externalId, status: updated.status, lastSeenAt })
    return updated
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/modules/devices/application/use-cases/update-device-status.use-case.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Write failing tests for the status listener**

`apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { DevicesStatusListener } from './devices-status.listener'

function makeContext(topic: string) {
  return { getTopic: () => topic } as any
}

describe('DevicesStatusListener', () => {
  it('calls the use-case with data extracted from a valid message', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new DevicesStatusListener(mockUseCase as any)
    const payload = { status: 'online', timestamp: '2026-07-05T10:00:00.000Z' }
    await listener.handleStatus(payload, makeContext('devices/device-1/status'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({ externalId: 'device-1', status: 'online', timestamp: '2026-07-05T10:00:00.000Z' })
  })

  it('discards a malformed message without calling the use-case', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new DevicesStatusListener(mockUseCase as any)
    await listener.handleStatus({ status: 'not-a-real-status' }, makeContext('devices/device-1/status'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 10: Implement the listener**

`apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.ts`:
```typescript
import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { deviceStatusMessageSchema } from '@mqtt-poc/shared'
import { UpdateDeviceStatusUseCase } from '../../application/use-cases/update-device-status.use-case'

@Controller()
export class DevicesStatusListener {
  private readonly logger = new Logger(DevicesStatusListener.name)

  constructor(private readonly updateDeviceStatus: UpdateDeviceStatusUseCase) {}

  @EventPattern('devices/+/status')
  async handleStatus(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = deviceStatusMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de status inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.updateDeviceStatus.execute({ externalId, ...parsed.data })
  }
}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/modules/devices/presentation/mqtt/devices-status.listener.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 12: Wire the use-case and listener into `DevicesModule`**

Modify `apps/api/src/modules/devices/devices.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { DEVICES_REPOSITORY } from './domain/devices.repository'
import { PrismaDevicesRepository } from './infrastructure/prisma-devices.repository'
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case'
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case'
import { GetDeviceUseCase } from './application/use-cases/get-device.use-case'
import { UpdateDeviceStatusUseCase } from './application/use-cases/update-device-status.use-case'
import { DevicesController } from './presentation/controllers/devices.controller'
import { DevicesStatusListener } from './presentation/mqtt/devices-status.listener'

@Module({
  providers: [
    PrismaService,
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    RegisterDeviceUseCase,
    ListDevicesUseCase,
    GetDeviceUseCase,
    UpdateDeviceStatusUseCase,
  ],
  controllers: [DevicesController, DevicesStatusListener],
  exports: [DEVICES_REPOSITORY, RegisterDeviceUseCase, ListDevicesUseCase, GetDeviceUseCase],
})
export class DevicesModule {}
```

- [ ] **Step 13: Manually verify end-to-end status ingestion**

Run:
```bash
pnpm --filter @mqtt-poc/api build
pnpm --filter @mqtt-poc/api start &
sleep 2
DEVICE_ID=$(curl -s -X POST http://localhost:3333/devices -H "Content-Type: application/json" -d '{"externalId":"device-002","name":"Sensor 2"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id' 2>/dev/null || true)
docker compose exec -T mosquitto mosquitto_pub -t "devices/device-002/status" -m '{"status":"online","timestamp":"2026-07-05T10:00:00.000Z"}'
sleep 1
curl -s http://localhost:3333/devices
kill %1
```
Expected: the returned device list shows `device-002` with `"status":"ONLINE"`.

- [ ] **Step 14: Commit**

```bash
git add mosquitto.conf docker-compose.yml apps/api/src/shared/mqtt apps/api/src/main.ts apps/api/src/modules/devices
git commit -m "feat: wire MQTT microservice and ingest device status"
```

---

### Task 7: Commands Module (REST)

**Files:**
- Create: `apps/api/src/modules/commands/domain/commands.repository.ts`
- Create: `apps/api/src/modules/commands/infrastructure/prisma-commands.repository.ts`
- Create: `apps/api/src/modules/commands/application/use-cases/create-command.use-case.ts`
- Test: `apps/api/src/modules/commands/application/use-cases/create-command.use-case.spec.ts`
- Create: `apps/api/src/modules/commands/application/use-cases/list-commands.use-case.ts`
- Test: `apps/api/src/modules/commands/application/use-cases/list-commands.use-case.spec.ts`
- Create: `apps/api/src/modules/commands/application/use-cases/get-command.use-case.ts`
- Test: `apps/api/src/modules/commands/application/use-cases/get-command.use-case.spec.ts`
- Create: `apps/api/src/modules/commands/presentation/dtos/create-command.dto.ts`
- Create: `apps/api/src/modules/commands/presentation/dtos/list-commands-query.dto.ts`
- Create: `apps/api/src/modules/commands/presentation/controllers/commands.controller.ts`
- Create: `apps/api/src/modules/commands/commands.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `MqttPublisherService.publish` (Task 4), `PrismaService` (Task 3).
- Produces: `CommandsRepository` interface + `COMMANDS_REPOSITORY` token (`create`, `updateStatus`, `findById`, `list`, `findDeviceById`, `findByDeviceExternalIdAndId`) — `updateStatus` and `findByDeviceExternalIdAndId` consumed by Task 8; `updateStatus` also consumed by Task 10. REST routes: `POST /commands`, `GET /commands`, `GET /commands/:id`.

- [ ] **Step 1: Define the repository interface**

`apps/api/src/modules/commands/domain/commands.repository.ts`:
```typescript
import { Command, CommandStatus } from '@prisma/client'

export interface CommandsRepository {
  create(data: { deviceId: string; type: string; payload?: unknown }): Promise<Command>
  updateStatus(id: string, data: { status: CommandStatus; response?: unknown; respondedAt?: Date }): Promise<Command | null>
  findById(id: string): Promise<Command | null>
  list(status?: CommandStatus): Promise<Command[]>
  findDeviceById(deviceId: string): Promise<{ id: string; externalId: string } | null>
  findByDeviceExternalIdAndId(externalId: string, commandId: string): Promise<Command | null>
}

export const COMMANDS_REPOSITORY = Symbol('COMMANDS_REPOSITORY')
```

- [ ] **Step 2: Implement the Prisma repository**

`apps/api/src/modules/commands/infrastructure/prisma-commands.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common'
import { CommandStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { CommandsRepository } from '../domain/commands.repository'

@Injectable()
export class PrismaCommandsRepository implements CommandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { deviceId: string; type: string; payload?: unknown }) {
    return this.prisma.command.create({
      data: {
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue | undefined,
      },
    })
  }

  async updateStatus(id: string, data: { status: CommandStatus; response?: unknown; respondedAt?: Date }) {
    try {
      return await this.prisma.command.update({
        where: { id },
        data: {
          status: data.status,
          response: data.response as Prisma.InputJsonValue | undefined,
          respondedAt: data.respondedAt,
        },
      })
    } catch {
      return null
    }
  }

  findById(id: string) {
    return this.prisma.command.findUnique({ where: { id } })
  }

  list(status?: CommandStatus) {
    return this.prisma.command.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    })
  }

  findDeviceById(deviceId: string) {
    return this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, externalId: true } })
  }

  findByDeviceExternalIdAndId(externalId: string, commandId: string) {
    return this.prisma.command.findFirst({ where: { id: commandId, device: { externalId } } })
  }
}
```

- [ ] **Step 3: Write failing tests for the use-cases**

`apps/api/src/modules/commands/application/use-cases/create-command.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CreateCommandUseCase } from './create-command.use-case'

const mockRepo = { findDeviceById: vi.fn(), create: vi.fn(), updateStatus: vi.fn() }
const mockPublisher = { publish: vi.fn() }

describe('CreateCommandUseCase', () => {
  const useCase = new CreateCommandUseCase(mockRepo as any, mockPublisher as any)

  beforeEach(() => vi.clearAllMocks())

  it('creates and publishes a command for an existing device', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    mockRepo.create.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PENDING })
    mockPublisher.publish.mockResolvedValue(undefined)

    const result = await useCase.execute({ deviceId: 'd1', type: 'REBOOT' })

    expect(mockPublisher.publish).toHaveBeenCalledWith('devices/device-1/commands', {
      commandId: 'c1', type: 'REBOOT', payload: null,
    })
    expect(result.status).toBe(CommandStatus.PENDING)
  })

  it('throws NotFoundException when device does not exist', async () => {
    mockRepo.findDeviceById.mockResolvedValue(null)
    await expect(useCase.execute({ deviceId: 'unknown', type: 'REBOOT' })).rejects.toThrow(NotFoundException)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('marks the command as PUBLISH_FAILED when publishing fails', async () => {
    mockRepo.findDeviceById.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    mockRepo.create.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PENDING })
    mockPublisher.publish.mockRejectedValue(new Error('broker unavailable'))
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null, status: CommandStatus.PUBLISH_FAILED })

    const result = await useCase.execute({ deviceId: 'd1', type: 'REBOOT' })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', { status: CommandStatus.PUBLISH_FAILED })
    expect(result.status).toBe(CommandStatus.PUBLISH_FAILED)
  })
})
```

`apps/api/src/modules/commands/application/use-cases/list-commands.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { CommandStatus } from '@prisma/client'
import { ListCommandsUseCase } from './list-commands.use-case'

describe('ListCommandsUseCase', () => {
  it('lists all commands when no status filter is given', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([{ id: 'c1' }]) }
    const useCase = new ListCommandsUseCase(mockRepo as any)
    await useCase.execute()
    expect(mockRepo.list).toHaveBeenCalledWith(undefined)
  })

  it('forwards the status filter to the repository', async () => {
    const mockRepo = { list: vi.fn().mockResolvedValue([]) }
    const useCase = new ListCommandsUseCase(mockRepo as any)
    await useCase.execute(CommandStatus.PENDING)
    expect(mockRepo.list).toHaveBeenCalledWith(CommandStatus.PENDING)
  })
})
```

`apps/api/src/modules/commands/application/use-cases/get-command.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { GetCommandUseCase } from './get-command.use-case'

describe('GetCommandUseCase', () => {
  it('returns the command when found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }) }
    const useCase = new GetCommandUseCase(mockRepo as any)
    const result = await useCase.execute('c1')
    expect(result.id).toBe('c1')
  })

  it('throws NotFoundException when command does not exist', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(null) }
    const useCase = new GetCommandUseCase(mockRepo as any)
    await expect(useCase.execute('unknown')).rejects.toThrow(NotFoundException)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/src/modules/commands`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the use-cases**

`apps/api/src/modules/commands/application/use-cases/create-command.use-case.ts`:
```typescript
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'
import { MqttPublisherService } from '../../../../shared/mqtt/mqtt-publisher.service'

@Injectable()
export class CreateCommandUseCase {
  private readonly logger = new Logger(CreateCommandUseCase.name)

  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly publisher: MqttPublisherService,
  ) {}

  async execute(input: { deviceId: string; type: string; payload?: unknown }) {
    const device = await this.repo.findDeviceById(input.deviceId)
    if (!device) throw new NotFoundException('Dispositivo não encontrado')

    const command = await this.repo.create(input)

    try {
      await this.publisher.publish(`devices/${device.externalId}/commands`, {
        commandId: command.id,
        type: command.type,
        payload: command.payload,
      })
      return command
    } catch (error) {
      this.logger.error(`Falha ao publicar comando ${command.id} para ${device.externalId}: ${(error as Error).message}`)
      const failed = await this.repo.updateStatus(command.id, { status: CommandStatus.PUBLISH_FAILED })
      return failed ?? command
    }
  }
}
```

`apps/api/src/modules/commands/application/use-cases/list-commands.use-case.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class ListCommandsUseCase {
  constructor(@Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository) {}

  execute(status?: CommandStatus) {
    return this.repo.list(status)
  }
}
```

`apps/api/src/modules/commands/application/use-cases/get-command.use-case.ts`:
```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class GetCommandUseCase {
  constructor(@Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository) {}

  async execute(id: string) {
    const command = await this.repo.findById(id)
    if (!command) throw new NotFoundException('Comando não encontrado')
    return command
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/src/modules/commands`
Expected: PASS (7 tests).

- [ ] **Step 7: Add DTOs, controller, and module wiring**

`apps/api/src/modules/commands/presentation/dtos/create-command.dto.ts`:
```typescript
import { IsObject, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateCommandDto {
  @IsString()
  deviceId: string

  @IsString()
  @MinLength(1)
  type: string

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}
```

`apps/api/src/modules/commands/presentation/dtos/list-commands-query.dto.ts`:
```typescript
import { IsEnum, IsOptional } from 'class-validator'
import { CommandStatus } from '@prisma/client'

export class ListCommandsQueryDto {
  @IsOptional()
  @IsEnum(CommandStatus)
  status?: CommandStatus
}
```

`apps/api/src/modules/commands/presentation/controllers/commands.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CreateCommandUseCase } from '../../application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from '../../application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from '../../application/use-cases/get-command.use-case'
import { CreateCommandDto } from '../dtos/create-command.dto'
import { ListCommandsQueryDto } from '../dtos/list-commands-query.dto'

@ApiTags('commands')
@Controller('commands')
export class CommandsController {
  constructor(
    private readonly createCommand: CreateCommandUseCase,
    private readonly listCommands: ListCommandsUseCase,
    private readonly getCommand: GetCommandUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateCommandDto) {
    return this.createCommand.execute(dto)
  }

  @Get()
  list(@Query() query: ListCommandsQueryDto) {
    return this.listCommands.execute(query.status)
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getCommand.execute(id)
  }
}
```

`apps/api/src/modules/commands/commands.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { MqttClientModule } from '../../shared/mqtt/mqtt-client.module'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { CommandsController } from './presentation/controllers/commands.controller'

@Module({
  imports: [MqttClientModule],
  providers: [
    PrismaService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
  ],
  controllers: [CommandsController],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
```

- [ ] **Step 8: Wire `CommandsModule` into `AppModule`**

Modify `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'
import { CommandsModule } from './modules/commands/commands.module'

@Module({
  imports: [EventEmitterModule.forRoot(), DevicesModule, CommandsModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

- [ ] **Step 9: Manually verify command creation and publishing**

Run:
```bash
pnpm --filter @mqtt-poc/api build
pnpm --filter @mqtt-poc/api start &
sleep 2
docker compose exec -T mosquitto mosquitto_sub -t "devices/device-001/commands" -C 1 > /tmp/received-command.json &
sleep 1
DEVICE=$(curl -s http://localhost:3333/devices | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].id')
curl -s -X POST http://localhost:3333/commands -H "Content-Type: application/json" -d "{\"deviceId\":\"$DEVICE\",\"type\":\"REBOOT\"}"
sleep 1
cat /tmp/received-command.json
kill %1
```
Expected: the created command has `"status":"PENDING"`; `/tmp/received-command.json` contains `{"commandId":"...","type":"REBOOT","payload":null}`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/commands apps/api/src/app.module.ts
git commit -m "feat: add commands module with REST create/list/get and MQTT publish"
```

---

### Task 8: Command Response Ingestion

**Files:**
- Create: `apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.ts`
- Test: `apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.spec.ts`
- Create: `apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.ts`
- Test: `apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.spec.ts`
- Modify: `apps/api/src/modules/commands/commands.module.ts`

**Interfaces:**
- Consumes: `CommandsRepository.updateStatus`, `CommandsRepository.findByDeviceExternalIdAndId` (Task 7), `commandResponseMessageSchema` (Task 2).
- Produces: emits internal event `command.updated` with payload `{ externalId: string; commandId: string; status: CommandStatus; response: unknown; respondedAt: Date | null }`, consumed by Task 9's `StatusGateway`.

- [ ] **Step 1: Write failing tests for `HandleCommandResponseUseCase`**

`apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandStatus } from '@prisma/client'
import { HandleCommandResponseUseCase } from './handle-command-response.use-case'

const mockRepo = { findByDeviceExternalIdAndId: vi.fn(), updateStatus: vi.fn() }
const mockEvents = { emit: vi.fn() }

describe('HandleCommandResponseUseCase', () => {
  const useCase = new HandleCommandResponseUseCase(mockRepo as any, mockEvents as any)

  beforeEach(() => vi.clearAllMocks())

  it('updates the command to ACKED and emits command.updated', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue({ id: 'c1' })
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', status: CommandStatus.ACKED, response: { ok: true }, respondedAt: new Date('2026-07-05T10:00:00.000Z') })

    await useCase.execute({ externalId: 'device-1', commandId: 'c1', status: 'ACKED', payload: { ok: true } })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', {
      status: CommandStatus.ACKED, response: { ok: true }, respondedAt: expect.any(Date),
    })
    expect(mockEvents.emit).toHaveBeenCalledWith('command.updated', expect.objectContaining({
      externalId: 'device-1', commandId: 'c1', status: CommandStatus.ACKED,
    }))
  })

  it('updates the command to FAILED', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue({ id: 'c1' })
    mockRepo.updateStatus.mockResolvedValue({ id: 'c1', status: CommandStatus.FAILED, response: null, respondedAt: new Date() })

    await useCase.execute({ externalId: 'device-1', commandId: 'c1', status: 'FAILED' })

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('c1', expect.objectContaining({ status: CommandStatus.FAILED }))
  })

  it('logs and does nothing when the command is unknown for that device', async () => {
    mockRepo.findByDeviceExternalIdAndId.mockResolvedValue(null)
    const result = await useCase.execute({ externalId: 'device-1', commandId: 'unknown-command', status: 'ACKED' })
    expect(result).toBeNull()
    expect(mockRepo.updateStatus).not.toHaveBeenCalled()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `HandleCommandResponseUseCase`**

`apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CommandStatus } from '@prisma/client'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class HandleCommandResponseUseCase {
  private readonly logger = new Logger(HandleCommandResponseUseCase.name)

  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; commandId: string; status: 'ACKED' | 'FAILED'; payload?: unknown }) {
    const command = await this.repo.findByDeviceExternalIdAndId(input.externalId, input.commandId)
    if (!command) {
      this.logger.warn(`Resposta recebida para comando desconhecido: ${input.commandId} (dispositivo ${input.externalId})`)
      return null
    }

    const status = input.status === 'ACKED' ? CommandStatus.ACKED : CommandStatus.FAILED
    const updated = await this.repo.updateStatus(command.id, { status, response: input.payload, respondedAt: new Date() })
    if (updated) {
      this.events.emit('command.updated', {
        externalId: input.externalId,
        commandId: updated.id,
        status: updated.status,
        response: updated.response,
        respondedAt: updated.respondedAt,
      })
    }
    return updated
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/modules/commands/application/use-cases/handle-command-response.use-case.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing tests for the response listener**

`apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { CommandResponsesListener } from './command-responses.listener'

function makeContext(topic: string) {
  return { getTopic: () => topic } as any
}

describe('CommandResponsesListener', () => {
  it('calls the use-case with data extracted from a valid message', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new CommandResponsesListener(mockUseCase as any)
    const payload = { commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED', payload: { ok: true } }
    await listener.handleResponse(payload, makeContext('devices/device-1/responses'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({
      externalId: 'device-1', commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED', payload: { ok: true },
    })
  })

  it('discards a malformed message without calling the use-case', async () => {
    const mockUseCase = { execute: vi.fn() }
    const listener = new CommandResponsesListener(mockUseCase as any)
    await listener.handleResponse({ commandId: 'not-a-uuid', status: 'DONE' }, makeContext('devices/device-1/responses'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement the listener**

`apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.ts`:
```typescript
import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { commandResponseMessageSchema } from '@mqtt-poc/shared'
import { HandleCommandResponseUseCase } from '../../application/use-cases/handle-command-response.use-case'

@Controller()
export class CommandResponsesListener {
  private readonly logger = new Logger(CommandResponsesListener.name)

  constructor(private readonly handleCommandResponse: HandleCommandResponseUseCase) {}

  @EventPattern('devices/+/responses')
  async handleResponse(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = commandResponseMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de resposta inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.handleCommandResponse.execute({ externalId, ...parsed.data })
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/modules/commands/presentation/mqtt/command-responses.listener.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Wire the use-case and listener into `CommandsModule`**

Modify `apps/api/src/modules/commands/commands.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { MqttClientModule } from '../../shared/mqtt/mqtt-client.module'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { HandleCommandResponseUseCase } from './application/use-cases/handle-command-response.use-case'
import { CommandsController } from './presentation/controllers/commands.controller'
import { CommandResponsesListener } from './presentation/mqtt/command-responses.listener'

@Module({
  imports: [MqttClientModule],
  providers: [
    PrismaService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
    HandleCommandResponseUseCase,
  ],
  controllers: [CommandsController, CommandResponsesListener],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/commands
git commit -m "feat: ingest command responses over MQTT"
```

---

### Task 9: Realtime WebSocket Gateway

**Files:**
- Create: `apps/api/src/shared/realtime/status.gateway.ts`
- Test: `apps/api/src/shared/realtime/status.gateway.spec.ts`
- Create: `apps/api/src/shared/realtime/realtime.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: internal events `device.status-changed` (Task 6) and `command.updated` (Task 8).
- Produces: Socket.IO events `device:status` and `command:updated`, emitted to room `device:{externalId}` — consumed by the future web frontend (out of scope for this plan).

- [ ] **Step 1: Write failing tests for `StatusGateway`**

`apps/api/src/shared/realtime/status.gateway.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { StatusGateway } from './status.gateway'

function makeServer() {
  const emit = vi.fn()
  const to = vi.fn().mockReturnValue({ emit })
  return { to, emit }
}

describe('StatusGateway', () => {
  it('joins the room for the given device on subscribe', () => {
    const gateway = new StatusGateway()
    const join = vi.fn()
    gateway.handleSubscribe('device-1', { join } as any)
    expect(join).toHaveBeenCalledWith('device:device-1')
  })

  it('emits command:updated to the device room when command.updated fires', () => {
    const gateway = new StatusGateway()
    const server = makeServer()
    gateway.server = server as any
    const respondedAt = new Date('2026-07-05T10:00:00.000Z')
    gateway.handleCommandUpdated({
      externalId: 'device-1', commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt,
    })
    expect(server.to).toHaveBeenCalledWith('device:device-1')
    expect(server.emit).toHaveBeenCalledWith('command:updated', {
      commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt,
    })
  })

  it('emits device:status to the device room when device.status-changed fires', () => {
    const gateway = new StatusGateway()
    const server = makeServer()
    gateway.server = server as any
    const lastSeenAt = new Date('2026-07-05T10:05:00.000Z')
    gateway.handleDeviceStatusChanged({ externalId: 'device-1', status: 'ONLINE', lastSeenAt })
    expect(server.to).toHaveBeenCalledWith('device:device-1')
    expect(server.emit).toHaveBeenCalledWith('device:status', { externalId: 'device-1', status: 'ONLINE', lastSeenAt })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/shared/realtime/status.gateway.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `StatusGateway`**

`apps/api/src/shared/realtime/status.gateway.ts`:
```typescript
import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

interface CommandUpdatedEvent {
  externalId: string
  commandId: string
  status: string
  response: unknown
  respondedAt: Date | null
}

interface DeviceStatusChangedEvent {
  externalId: string
  status: string
  lastSeenAt: Date
}

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
@Injectable()
export class StatusGateway {
  @WebSocketServer()
  server: Server

  @SubscribeMessage('subscribe:device')
  handleSubscribe(@MessageBody() externalId: string, @ConnectedSocket() client: Socket) {
    client.join(`device:${externalId}`)
  }

  @OnEvent('command.updated')
  handleCommandUpdated(event: CommandUpdatedEvent) {
    this.server.to(`device:${event.externalId}`).emit('command:updated', {
      commandId: event.commandId,
      status: event.status,
      response: event.response,
      respondedAt: event.respondedAt,
    })
  }

  @OnEvent('device.status-changed')
  handleDeviceStatusChanged(event: DeviceStatusChangedEvent) {
    this.server.to(`device:${event.externalId}`).emit('device:status', {
      externalId: event.externalId,
      status: event.status,
      lastSeenAt: event.lastSeenAt,
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/shared/realtime/status.gateway.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the realtime module and wire it into `AppModule`**

`apps/api/src/shared/realtime/realtime.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { StatusGateway } from './status.gateway'

@Module({
  providers: [StatusGateway],
  exports: [StatusGateway],
})
export class RealtimeModule {}
```

Modify `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'
import { CommandsModule } from './modules/commands/commands.module'
import { RealtimeModule } from './shared/realtime/realtime.module'

@Module({
  imports: [EventEmitterModule.forRoot(), DevicesModule, CommandsModule, RealtimeModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shared/realtime apps/api/src/app.module.ts
git commit -m "feat: add WebSocket gateway for realtime command/device status updates"
```

---

### Task 10: Command Expiration (Timeout Job)

**Files:**
- Modify: `apps/api/src/modules/commands/domain/commands.repository.ts`
- Modify: `apps/api/src/modules/commands/infrastructure/prisma-commands.repository.ts`
- Create: `apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.ts`
- Test: `apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.spec.ts`
- Create: `apps/api/src/modules/commands/tasks/expire-commands.task.ts`
- Modify: `apps/api/src/modules/commands/commands.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `MQTT_COMMAND_TIMEOUT_MS`, `MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS` env vars.
- Produces: `CommandsRepository.expireStalePending(cutoff: Date): Promise<Array<{ id: string; deviceId: string; externalId: string }>>`, used only within this task and verified end-to-end in Task 11.

- [ ] **Step 1: Add `expireStalePending` to the repository interface**

Modify `apps/api/src/modules/commands/domain/commands.repository.ts` (add to the interface):
```typescript
import { Command, CommandStatus } from '@prisma/client'

export interface CommandsRepository {
  create(data: { deviceId: string; type: string; payload?: unknown }): Promise<Command>
  updateStatus(id: string, data: { status: CommandStatus; response?: unknown; respondedAt?: Date }): Promise<Command | null>
  findById(id: string): Promise<Command | null>
  list(status?: CommandStatus): Promise<Command[]>
  findDeviceById(deviceId: string): Promise<{ id: string; externalId: string } | null>
  findByDeviceExternalIdAndId(externalId: string, commandId: string): Promise<Command | null>
  expireStalePending(cutoff: Date): Promise<Array<{ id: string; deviceId: string; externalId: string }>>
}

export const COMMANDS_REPOSITORY = Symbol('COMMANDS_REPOSITORY')
```

- [ ] **Step 2: Implement `expireStalePending` with an atomic, idempotent query**

Modify `apps/api/src/modules/commands/infrastructure/prisma-commands.repository.ts` (add this method to the class):
```typescript
  async expireStalePending(cutoff: Date) {
    return this.prisma.$queryRaw<Array<{ id: string; deviceId: string; externalId: string }>>`
      UPDATE "Command" c
      SET status = 'TIMEOUT', "respondedAt" = now()
      FROM "Device" d
      WHERE c."deviceId" = d.id
        AND c.status = 'PENDING'
        AND c."createdAt" < ${cutoff}
      RETURNING c.id, c."deviceId", d."externalId"
    `
  }
```

- [ ] **Step 3: Write failing tests for `ExpireStaleCommandsUseCase`**

`apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.spec.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { ExpireStaleCommandsUseCase } from './expire-stale-commands.use-case'

describe('ExpireStaleCommandsUseCase', () => {
  it('expires stale commands and emits an event for each one', async () => {
    const mockRepo = {
      expireStalePending: vi.fn().mockResolvedValue([
        { id: 'c1', deviceId: 'd1', externalId: 'device-1' },
        { id: 'c2', deviceId: 'd2', externalId: 'device-2' },
      ]),
    }
    const mockEvents = { emit: vi.fn() }
    const useCase = new ExpireStaleCommandsUseCase(mockRepo as any, mockEvents as any)

    const result = await useCase.execute(60000)

    expect(result).toHaveLength(2)
    expect(mockEvents.emit).toHaveBeenCalledTimes(2)
    expect(mockEvents.emit).toHaveBeenCalledWith('command.updated', expect.objectContaining({
      externalId: 'device-1', commandId: 'c1', status: 'TIMEOUT',
    }))
  })

  it('does not emit anything when there are no stale commands', async () => {
    const mockRepo = { expireStalePending: vi.fn().mockResolvedValue([]) }
    const mockEvents = { emit: vi.fn() }
    const useCase = new ExpireStaleCommandsUseCase(mockRepo as any, mockEvents as any)

    await useCase.execute(60000)

    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement `ExpireStaleCommandsUseCase`**

`apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CommandsRepository, COMMANDS_REPOSITORY } from '../../domain/commands.repository'

@Injectable()
export class ExpireStaleCommandsUseCase {
  constructor(
    @Inject(COMMANDS_REPOSITORY) private readonly repo: CommandsRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(timeoutMs: number) {
    const cutoff = new Date(Date.now() - timeoutMs)
    const expired = await this.repo.expireStalePending(cutoff)
    for (const command of expired) {
      this.events.emit('command.updated', {
        externalId: command.externalId,
        commandId: command.id,
        status: 'TIMEOUT',
        response: null,
        respondedAt: new Date(),
      })
    }
    return expired
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/modules/commands/application/use-cases/expire-stale-commands.use-case.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Add the scheduled task**

`apps/api/src/modules/commands/tasks/expire-commands.task.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ExpireStaleCommandsUseCase } from '../application/use-cases/expire-stale-commands.use-case'

@Injectable()
export class ExpireCommandsTask {
  private readonly logger = new Logger(ExpireCommandsTask.name)

  constructor(private readonly expireStaleCommands: ExpireStaleCommandsUseCase) {}

  @Interval(Number(process.env.MQTT_COMMAND_EXPIRY_CHECK_INTERVAL_MS ?? '10000'))
  async handleInterval() {
    const timeoutMs = Number(process.env.MQTT_COMMAND_TIMEOUT_MS ?? '60000')
    const expired = await this.expireStaleCommands.execute(timeoutMs)
    if (expired.length > 0) {
      this.logger.log(`${expired.length} comando(s) expirado(s) por timeout`)
    }
  }
}
```

- [ ] **Step 8: Wire `ExpireStaleCommandsUseCase` and `ExpireCommandsTask` into `CommandsModule`, and `ScheduleModule` into `AppModule`**

Modify `apps/api/src/modules/commands/commands.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { MqttClientModule } from '../../shared/mqtt/mqtt-client.module'
import { COMMANDS_REPOSITORY } from './domain/commands.repository'
import { PrismaCommandsRepository } from './infrastructure/prisma-commands.repository'
import { CreateCommandUseCase } from './application/use-cases/create-command.use-case'
import { ListCommandsUseCase } from './application/use-cases/list-commands.use-case'
import { GetCommandUseCase } from './application/use-cases/get-command.use-case'
import { HandleCommandResponseUseCase } from './application/use-cases/handle-command-response.use-case'
import { ExpireStaleCommandsUseCase } from './application/use-cases/expire-stale-commands.use-case'
import { ExpireCommandsTask } from './tasks/expire-commands.task'
import { CommandsController } from './presentation/controllers/commands.controller'
import { CommandResponsesListener } from './presentation/mqtt/command-responses.listener'

@Module({
  imports: [MqttClientModule],
  providers: [
    PrismaService,
    { provide: COMMANDS_REPOSITORY, useClass: PrismaCommandsRepository },
    CreateCommandUseCase,
    ListCommandsUseCase,
    GetCommandUseCase,
    HandleCommandResponseUseCase,
    ExpireStaleCommandsUseCase,
    ExpireCommandsTask,
  ],
  controllers: [CommandsController, CommandResponsesListener],
  exports: [COMMANDS_REPOSITORY, CreateCommandUseCase, ListCommandsUseCase, GetCommandUseCase],
})
export class CommandsModule {}
```

Modify `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaService } from './shared/prisma/prisma.service'
import { DevicesModule } from './modules/devices/devices.module'
import { CommandsModule } from './modules/commands/commands.module'
import { RealtimeModule } from './shared/realtime/realtime.module'

@Module({
  imports: [EventEmitterModule.forRoot(), ScheduleModule.forRoot(), DevicesModule, CommandsModule, RealtimeModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/commands apps/api/src/app.module.ts
git commit -m "feat: expire stale PENDING commands via idempotent scheduled job"
```

---

### Task 11: Integration Tests

**Files:**
- Test: `apps/api/src/modules/commands/commands.integration.spec.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `createMqttMicroserviceOptions` (Task 6), `AppModule` (all prior tasks), `ExpireStaleCommandsUseCase` (Task 10), `PrismaService` (Task 3).
- Produces: nothing (terminal verification task).

- [ ] **Step 1: Add `mqtt` as a dependency available for tests**

Modify `apps/api/package.json` — confirm `"mqtt": "^5.10.1"` is present in `dependencies` (already added in Task 3, no change needed). Run `pnpm install` to ensure the lockfile is current.

- [ ] **Step 2: Write the integration test file**

`apps/api/src/modules/commands/commands.integration.spec.ts`:
```typescript
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mqtt, { type MqttClient } from 'mqtt'
import { PrismaService } from '../../shared/prisma/prisma.service'

function assertLocalIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    throw new Error('Testes de integração devem rodar contra um banco local (DATABASE_URL deve apontar para localhost).')
  }
}

describe('Commands integration', () => {
  const runId = `cmd-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let app: INestApplication
  let moduleRef: TestingModule
  let prisma: PrismaService
  let baseUrl: string
  let deviceClient: MqttClient
  const deviceExternalId = `device-${runId}`
  const deviceIds: string[] = []

  async function cleanup() {
    if (!prisma) return
    await prisma.command.deleteMany({ where: { deviceId: { in: deviceIds } } })
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } })
  }

  beforeAll(async () => {
    assertLocalIntegrationDatabase()

    const { AppModule } = await import('../../app.module')
    const { createMqttMicroserviceOptions } = await import('../../shared/mqtt/mqtt-microservice-options')

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.connectMicroservice(createMqttMicroserviceOptions())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.startAllMicroservices()
    await app.listen(0)

    prisma = app.get(PrismaService)
    baseUrl = await app.getUrl()

    deviceClient = mqtt.connect(process.env.MQTT_URL as string, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
    })
    await new Promise<void>((resolve, reject) => {
      deviceClient.once('connect', () => resolve())
      deviceClient.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      deviceClient.subscribe(`devices/${deviceExternalId}/commands`, (err) => (err ? reject(err) : resolve()))
    })
  }, 30000)

  afterAll(async () => {
    await cleanup()
    deviceClient?.end(true)
    await app?.close()
    await moduleRef?.close()
  })

  it('delivers a command to the device and processes its ACKED response', async () => {
    const device = await prisma.device.create({
      data: { externalId: deviceExternalId, name: `Dispositivo ${runId}` },
    })
    deviceIds.push(device.id)

    const commandReceived = new Promise<{ commandId: string; type: string }>((resolve) => {
      deviceClient.once('message', (_topic, buffer) => {
        resolve(JSON.parse(buffer.toString()))
      })
    })

    const createRes = await fetch(`${baseUrl}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, type: 'REBOOT' }),
    })
    const created = (await createRes.json()) as { id: string; status: string }
    expect(created.status).toBe('PENDING')

    const received = await commandReceived
    expect(received.commandId).toBe(created.id)
    expect(received.type).toBe('REBOOT')

    deviceClient.publish(
      `devices/${deviceExternalId}/responses`,
      JSON.stringify({ commandId: created.id, status: 'ACKED', payload: { ok: true } }),
    )

    await new Promise((resolve) => setTimeout(resolve, 500))

    const getRes = await fetch(`${baseUrl}/commands/${created.id}`)
    const updated = (await getRes.json()) as { status: string; response: unknown }
    expect(updated.status).toBe('ACKED')
    expect(updated.response).toEqual({ ok: true })
  }, 15000)

  it('updates device status to ONLINE then OFFLINE via a message with LWT configured', async () => {
    const externalId = `device-lwt-${runId}`
    const device = await prisma.device.create({ data: { externalId, name: `LWT ${runId}` } })
    deviceIds.push(device.id)

    const lwtClient = mqtt.connect(process.env.MQTT_URL as string, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      will: {
        topic: `devices/${externalId}/status`,
        payload: JSON.stringify({ status: 'offline', timestamp: new Date().toISOString() }),
        qos: 1,
        retain: true,
      },
    })
    await new Promise<void>((resolve, reject) => {
      lwtClient.once('connect', () => resolve())
      lwtClient.once('error', reject)
    })
    lwtClient.publish(
      `devices/${externalId}/status`,
      JSON.stringify({ status: 'online', timestamp: new Date().toISOString() }),
      { qos: 1, retain: true },
    )

    await new Promise((resolve) => setTimeout(resolve, 500))
    const onlineRes = await fetch(`${baseUrl}/devices/${device.id}`)
    const online = (await onlineRes.json()) as { status: string }
    expect(online.status).toBe('ONLINE')

    lwtClient.end(true)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const offlineRes = await fetch(`${baseUrl}/devices/${device.id}`)
    const offline = (await offlineRes.json()) as { status: string }
    expect(offline.status).toBe('OFFLINE')
  }, 15000)

  it('expires a stale PENDING command exactly once even if triggered twice concurrently', async () => {
    const device = await prisma.device.create({
      data: { externalId: `device-timeout-${runId}`, name: `Timeout ${runId}` },
    })
    deviceIds.push(device.id)

    const staleCommand = await prisma.command.create({ data: { deviceId: device.id, type: 'REBOOT' } })
    await prisma.command.update({
      where: { id: staleCommand.id },
      data: { createdAt: new Date(Date.now() - 1000 * 60 * 60) },
    })

    const { ExpireStaleCommandsUseCase } = await import('./application/use-cases/expire-stale-commands.use-case')
    const useCase = app.get(ExpireStaleCommandsUseCase)

    const [firstRun, secondRun] = await Promise.all([useCase.execute(1000), useCase.execute(1000)])

    expect(firstRun.length + secondRun.length).toBe(1)

    const finalCommand = await prisma.command.findUniqueOrThrow({ where: { id: staleCommand.id } })
    expect(finalCommand.status).toBe('TIMEOUT')
  }, 15000)
})
```

- [ ] **Step 3: Run the integration tests to verify they fail without infra**

Run: `docker compose down && pnpm test:integration`
Expected: FAIL — connection refused to Postgres and/or MQTT.

- [ ] **Step 4: Start the full local stack and run the migration**

Run:
```bash
docker compose up -d
until docker compose exec -T postgres pg_isready -U mqtt -d mqtt_poc; do sleep 1; done
pnpm prisma migrate deploy
```
Expected: both containers running, migration applied cleanly.

- [ ] **Step 5: Run the integration tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS (3 tests) — command delivery + ACKED response, LWT online/offline, and idempotent expiration.

- [ ] **Step 6: Run the full unit test suite once more to confirm no regressions**

Run: `pnpm test`
Expected: PASS (all unit tests across `packages/shared` and `apps/api`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/commands/commands.integration.spec.ts
git commit -m "test: add end-to-end integration tests for MQTT command flow"
```

---

## Self-Review Notes

- **Spec coverage:** monorepo layout ✓ (Task 1), Prisma schema with comments ✓ (Task 1), MQTT topics/contracts ✓ (Task 2, 6, 8), Hybrid App MQTT integration ✓ (Task 6), Devices module ✓ (Task 5, 6), Commands module ✓ (Task 7, 8), publish-failure traceability (`PUBLISH_FAILED`) ✓ (Task 7), configurable QoS ✓ (Task 4), WebSocket realtime ✓ (Task 9), idempotent timeout expiration ✓ (Task 10), integration tests (full flow, LWT, expiration idempotency) ✓ (Task 11). Device simulator and web frontend are intentionally **out of scope for this plan** — they depend on the contracts and REST/MQTT surface built here and should be planned separately once this is merged.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `DevicesRepository`/`CommandsRepository` method names and signatures are identical between their first definition (Tasks 5, 7) and every later consumer (Tasks 6, 8, 10, 11). Event payload shapes (`device.status-changed`, `command.updated`) match between emitters (Tasks 6, 8, 10) and the `StatusGateway` consumer (Task 9).
