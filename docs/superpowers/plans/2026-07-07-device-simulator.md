# Device Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/device-simulator` — a standalone Node/TS process that simulates a real IoT device on the MQTT broker, so the full command flow (API → broker → device → response → API → WebSocket) can be exercised end-to-end without hardware.

**Architecture:** Plain Node process (NOT a NestJS app) using `mqtt.js` directly and the shared Zod contracts from `@mqtt-poc/shared`. Business logic (config parsing, message building, command→response mapping) is factored into small pure functions with unit tests; the MQTT client wiring (connect, LWT, subscribe, publish, delayed response) lives in a thin runtime layer verified by an integration test against the local Mosquitto broker.

**Tech Stack:** TypeScript 5.6 (CommonJS, via `tsc`), `mqtt` ^5.10.1, `@mqtt-poc/shared` (workspace), Vitest (unit + integration). Run with `node dist/index.js` after `tsc` build.

This plan corresponds to the "Simulador de dispositivo" section of `docs/superpowers/specs/2026-07-05-mqtt-device-commands-design.md`. The API (`apps/api`) it interoperates with is already built and merged.

## Global Constraints

- Node >= 22, pnpm >= 9.15.0 (pinned in root `package.json`); dev environment actually runs Node v20.18.0, so pnpm prints an engine WARN that is expected and must not be "fixed".
- TypeScript 5.6, `strict: true` (extend the root `tsconfig.base.json`).
- MQTT topics (device's perspective): subscribes `devices/{externalId}/commands`; publishes `devices/{externalId}/responses` and `devices/{externalId}/status`.
- The simulator is the DEVICE side: it configures a Last-Will-and-Testament (LWT) on `devices/{externalId}/status` with `{status:'offline', timestamp}`, and on connect publishes a **retained** `{status:'online', timestamp}` to the same topic.
- Wire payloads are plain JSON matching `@mqtt-poc/shared` contracts exactly — `commandMessageSchema` inbound, `commandResponseMessageSchema` outbound, `deviceStatusMessageSchema` for status. Never wrap in any envelope.
- `CommandResponseMessage.status` is one of `'ACKED' | 'FAILED'`. `DeviceStatusMessage.status` is one of `'online' | 'offline'`, `timestamp` is ISO 8601.
- Malformed inbound command messages are logged and dropped, never crash the process.
- Config comes from env vars, same names the API uses: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_QOS` (0/1/2, default 1), plus `DEVICE_EXTERNAL_ID`, `SIMULATOR_RESPONSE_DELAY_MS` (default 1000), `SIMULATOR_FAILURE_RATE` (0..1, default 0). `DEVICE_EXTERNAL_ID` may also be overridden by a `--externalId=...` CLI arg.
- Unit tests colocated as `*.spec.ts`; the one integration test is `*.integration.spec.ts`, picked up by the existing root `vitest.config.integration.ts`.
- QoS from config applies to subscribe, publish of responses, and publish of status (and the LWT).

---

### Task 1: Package Scaffold

**Files:**
- Create: `apps/device-simulator/package.json`
- Create: `apps/device-simulator/tsconfig.json`
- Create: `apps/device-simulator/.env.example`
- Create: `apps/device-simulator/src/index.ts` (temporary placeholder, replaced in Task 5)

**Interfaces:**
- Consumes: nothing (leaf app).
- Produces: the `@mqtt-poc/device-simulator` workspace package with a `build` script (`tsc`) and a `start` script (`node dist/index.js`), depending on `mqtt` and `@mqtt-poc/shared`.

- [ ] **Step 1: Create the package files**

`apps/device-simulator/package.json`:
```json
{
  "name": "@mqtt-poc/device-simulator",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@mqtt-poc/shared": "workspace:*",
    "mqtt": "^5.10.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  }
}
```

`apps/device-simulator/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "**/*.spec.ts", "**/*.integration.spec.ts"]
}
```

`apps/device-simulator/.env.example`:
```
MQTT_URL="mqtt://localhost:1883"
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_QOS=1
DEVICE_EXTERNAL_ID="device-001"
SIMULATOR_RESPONSE_DELAY_MS=1000
SIMULATOR_FAILURE_RATE=0
```

`apps/device-simulator/src/index.ts` (placeholder, replaced in Task 5):
```typescript
console.log('device-simulator placeholder')
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: completes; `@mqtt-poc/device-simulator` linked into the workspace (the root `postinstall` also rebuilds `@mqtt-poc/shared`). The Node-version WARN is expected.

- [ ] **Step 3: Verify it builds and runs**

Run: `pnpm --filter @mqtt-poc/device-simulator build && node apps/device-simulator/dist/index.js`
Expected: prints `device-simulator placeholder`.

- [ ] **Step 4: Commit**

```bash
git add apps/device-simulator/package.json apps/device-simulator/tsconfig.json apps/device-simulator/.env.example apps/device-simulator/src/index.ts pnpm-lock.yaml
git commit -m "feat(simulator): scaffold device-simulator package"
```

---

### Task 2: Config Loader

**Files:**
- Create: `apps/device-simulator/src/config.ts`
- Test: `apps/device-simulator/src/config.spec.ts`

**Interfaces:**
- Consumes: `process.env`, and an argv string array.
- Produces:
  - `interface SimulatorConfig { url: string; username?: string; password?: string; qos: 0 | 1 | 2; externalId: string; responseDelayMs: number; failureRate: number }`
  - `loadSimulatorConfig(env: NodeJS.ProcessEnv, argv: string[]): SimulatorConfig` — throws on missing `MQTT_URL`, invalid `MQTT_QOS`, missing `externalId`, or `SIMULATOR_FAILURE_RATE` outside `0..1`. A `--externalId=<value>` entry in `argv` overrides `DEVICE_EXTERNAL_ID`.

- [ ] **Step 1: Write the failing test**

`apps/device-simulator/src/config.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { loadSimulatorConfig } from './config'

const baseEnv = {
  MQTT_URL: 'mqtt://localhost:1883',
  DEVICE_EXTERNAL_ID: 'device-001',
}

describe('loadSimulatorConfig', () => {
  it('loads a valid config with defaults', () => {
    const config = loadSimulatorConfig(baseEnv, [])
    expect(config).toEqual({
      url: 'mqtt://localhost:1883',
      username: undefined,
      password: undefined,
      qos: 1,
      externalId: 'device-001',
      responseDelayMs: 1000,
      failureRate: 0,
    })
  })

  it('lets a --externalId CLI arg override DEVICE_EXTERNAL_ID', () => {
    const config = loadSimulatorConfig(baseEnv, ['--externalId=device-999'])
    expect(config.externalId).toBe('device-999')
  })

  it('parses username, password, qos, delay and failure rate from env', () => {
    const config = loadSimulatorConfig(
      { ...baseEnv, MQTT_USERNAME: 'u', MQTT_PASSWORD: 'p', MQTT_QOS: '2', SIMULATOR_RESPONSE_DELAY_MS: '500', SIMULATOR_FAILURE_RATE: '0.5' },
      [],
    )
    expect(config).toMatchObject({ username: 'u', password: 'p', qos: 2, responseDelayMs: 500, failureRate: 0.5 })
  })

  it('throws when MQTT_URL is missing', () => {
    expect(() => loadSimulatorConfig({ DEVICE_EXTERNAL_ID: 'd1' }, [])).toThrow('MQTT_URL não configurada')
  })

  it('throws when externalId is missing (no env and no CLI arg)', () => {
    expect(() => loadSimulatorConfig({ MQTT_URL: 'mqtt://localhost:1883' }, [])).toThrow('externalId não configurado')
  })

  it('throws when MQTT_QOS is not 0, 1 or 2', () => {
    expect(() => loadSimulatorConfig({ ...baseEnv, MQTT_QOS: '5' }, [])).toThrow('MQTT_QOS inválido')
  })

  it('throws when SIMULATOR_FAILURE_RATE is outside 0..1', () => {
    expect(() => loadSimulatorConfig({ ...baseEnv, SIMULATOR_FAILURE_RATE: '2' }, [])).toThrow('SIMULATOR_FAILURE_RATE inválido')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/device-simulator/src/config.spec.ts`
Expected: FAIL, module `./config` not found.

- [ ] **Step 3: Implement the config loader**

`apps/device-simulator/src/config.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/device-simulator/src/config.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/config.ts apps/device-simulator/src/config.spec.ts
git commit -m "feat(simulator): add config loader with env + CLI arg parsing"
```

---

### Task 3: Message Builders & Topic Helpers

**Files:**
- Create: `apps/device-simulator/src/messages.ts`
- Test: `apps/device-simulator/src/messages.spec.ts`

**Interfaces:**
- Consumes: `CommandMessage`, `CommandResponseMessage`, `DeviceStatusMessage` types/schemas from `@mqtt-poc/shared`; `SimulatorConfig` shape from Task 2 (only `externalId` field used here — passed as a plain string, not the whole config).
- Produces:
  - `commandsTopic(externalId: string): string` → `devices/{externalId}/commands`
  - `responsesTopic(externalId: string): string` → `devices/{externalId}/responses`
  - `statusTopic(externalId: string): string` → `devices/{externalId}/status`
  - `parseCommand(raw: Buffer | string): CommandMessage | null` — returns the parsed command on success, `null` on invalid JSON or schema mismatch (never throws).
  - `buildStatusMessage(status: 'online' | 'offline', now?: Date): DeviceStatusMessage`
  - `buildResponseMessage(commandId: string, status: 'ACKED' | 'FAILED'): CommandResponseMessage`
  - `decideResponseStatus(failureRate: number, rng?: () => number): 'ACKED' | 'FAILED'` — returns `'FAILED'` when `rng() < failureRate`, else `'ACKED'`; `rng` defaults to `Math.random`.

- [ ] **Step 1: Write the failing test**

`apps/device-simulator/src/messages.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  commandsTopic,
  responsesTopic,
  statusTopic,
  parseCommand,
  buildStatusMessage,
  buildResponseMessage,
  decideResponseStatus,
} from './messages'

describe('topic helpers', () => {
  it('builds the three device topics from an externalId', () => {
    expect(commandsTopic('device-1')).toBe('devices/device-1/commands')
    expect(responsesTopic('device-1')).toBe('devices/device-1/responses')
    expect(statusTopic('device-1')).toBe('devices/device-1/status')
  })
})

describe('parseCommand', () => {
  it('parses a valid command message from a Buffer', () => {
    const raw = Buffer.from(JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT', payload: { x: 1 } }))
    const result = parseCommand(raw)
    expect(result).toEqual({ commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT', payload: { x: 1 } })
  })

  it('returns null for invalid JSON', () => {
    expect(parseCommand(Buffer.from('not json'))).toBeNull()
  })

  it('returns null for a schema-invalid message (missing commandId)', () => {
    expect(parseCommand(Buffer.from(JSON.stringify({ type: 'REBOOT' })))).toBeNull()
  })
})

describe('buildStatusMessage', () => {
  it('builds an online status message with an ISO timestamp', () => {
    const msg = buildStatusMessage('online', new Date('2026-07-07T10:00:00.000Z'))
    expect(msg).toEqual({ status: 'online', timestamp: '2026-07-07T10:00:00.000Z' })
  })
})

describe('buildResponseMessage', () => {
  it('builds an ACKED response for a command id', () => {
    expect(buildResponseMessage('c1', 'ACKED')).toEqual({ commandId: 'c1', status: 'ACKED' })
  })
})

describe('decideResponseStatus', () => {
  it('returns FAILED when rng is below the failure rate', () => {
    expect(decideResponseStatus(0.5, () => 0.1)).toBe('FAILED')
  })

  it('returns ACKED when rng is at or above the failure rate', () => {
    expect(decideResponseStatus(0.5, () => 0.9)).toBe('ACKED')
  })

  it('always returns ACKED when failure rate is 0', () => {
    expect(decideResponseStatus(0, () => 0)).toBe('ACKED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/device-simulator/src/messages.spec.ts`
Expected: FAIL, module `./messages` not found.

- [ ] **Step 3: Implement the message helpers**

`apps/device-simulator/src/messages.ts`:
```typescript
import {
  commandMessageSchema,
  CommandMessage,
  CommandResponseMessage,
  DeviceStatusMessage,
} from '@mqtt-poc/shared'

export const commandsTopic = (externalId: string): string => `devices/${externalId}/commands`
export const responsesTopic = (externalId: string): string => `devices/${externalId}/responses`
export const statusTopic = (externalId: string): string => `devices/${externalId}/status`

export function parseCommand(raw: Buffer | string): CommandMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw.toString())
  } catch {
    return null
  }
  const parsed = commandMessageSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function buildStatusMessage(status: 'online' | 'offline', now: Date = new Date()): DeviceStatusMessage {
  return { status, timestamp: now.toISOString() }
}

export function buildResponseMessage(commandId: string, status: 'ACKED' | 'FAILED'): CommandResponseMessage {
  return { commandId, status }
}

export function decideResponseStatus(failureRate: number, rng: () => number = Math.random): 'ACKED' | 'FAILED' {
  return rng() < failureRate ? 'FAILED' : 'ACKED'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/device-simulator/src/messages.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/messages.ts apps/device-simulator/src/messages.spec.ts
git commit -m "feat(simulator): add topic helpers and message builders"
```

---

### Task 4: Simulator Runtime (MQTT wiring)

**Files:**
- Create: `apps/device-simulator/src/simulator.ts`
- Test: `apps/device-simulator/src/simulator.spec.ts`

**Interfaces:**
- Consumes: `SimulatorConfig` (Task 2); topic/message helpers (Task 3); `mqtt` package's `MqttClient` type and `connect` function.
- Produces:
  - `interface MqttLike { publish(topic: string, payload: string, opts: { qos: 0|1|2; retain?: boolean }, cb?: (err?: Error) => void): void; subscribe(topic: string, opts: { qos: 0|1|2 }, cb?: (err: Error | null) => void): void; on(event: 'connect' | 'message' | 'error', handler: (...args: any[]) => void): void; end(force?: boolean): void }` — the minimal surface of an mqtt client the simulator uses (so tests can pass a fake).
  - `function buildConnectOptions(config: SimulatorConfig): IClientOptions` — returns the `mqtt.connect` options including auth and the LWT `will` on the status topic (`{status:'offline'}`, qos from config, retain true).
  - `class DeviceSimulator` with constructor `(config: SimulatorConfig, client: MqttLike, deps?: { now?: () => Date; rng?: () => number; setTimeout?: typeof setTimeout })` and methods:
    - `start(): void` — registers `connect`/`message`/`error` handlers. On connect: publishes retained `online` status and subscribes to the commands topic. On message: parses the command (drop+log if invalid), then after `responseDelayMs` publishes a response with `decideResponseStatus`.
    - `stop(): void` — publishes an explicit `offline` status then calls `client.end()`.

- [ ] **Step 1: Write the failing test**

`apps/device-simulator/src/simulator.spec.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeviceSimulator, buildConnectOptions, MqttLike } from './simulator'
import type { SimulatorConfig } from './config'

const config: SimulatorConfig = {
  url: 'mqtt://localhost:1883',
  username: undefined,
  password: undefined,
  qos: 1,
  externalId: 'device-1',
  responseDelayMs: 500,
  failureRate: 0,
}

function makeFakeClient() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler
    }),
    emit: (event: string, ...args: any[]) => handlers[event]?.(...args),
  }
}

describe('buildConnectOptions', () => {
  it('includes an offline LWT on the status topic with the configured qos and retain', () => {
    const opts = buildConnectOptions(config)
    expect(opts.will).toMatchObject({
      topic: 'devices/device-1/status',
      qos: 1,
      retain: true,
    })
    const willPayload = JSON.parse(opts.will!.payload as string)
    expect(willPayload.status).toBe('offline')
    expect(typeof willPayload.timestamp).toBe('string')
  })

  it('passes username and password through when present', () => {
    const opts = buildConnectOptions({ ...config, username: 'u', password: 'p' })
    expect(opts).toMatchObject({ username: 'u', password: 'p' })
  })
})

describe('DeviceSimulator', () => {
  let client: ReturnType<typeof makeFakeClient>

  beforeEach(() => {
    client = makeFakeClient()
  })

  it('on connect, publishes retained online status and subscribes to the commands topic', () => {
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { now: () => new Date('2026-07-07T10:00:00.000Z') })
    sim.start()
    client.emit('connect')

    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/status',
      JSON.stringify({ status: 'online', timestamp: '2026-07-07T10:00:00.000Z' }),
      { qos: 1, retain: true },
      expect.any(Function),
    )
    expect(client.subscribe).toHaveBeenCalledWith('devices/device-1/commands', { qos: 1 }, expect.any(Function))
  })

  it('after a valid command and the response delay, publishes an ACKED response', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { rng: () => 0.9 })
    sim.start()
    const command = { commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT' }
    client.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(command)))

    expect(client.publish).not.toHaveBeenCalledWith('devices/device-1/responses', expect.anything(), expect.anything(), expect.anything())
    vi.advanceTimersByTime(500)

    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/responses',
      JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'ACKED' }),
      { qos: 1 },
      expect.any(Function),
    )
    vi.useRealTimers()
  })

  it('drops a malformed command without publishing a response', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(config, client as unknown as MqttLike)
    sim.start()
    client.emit('message', 'devices/device-1/commands', Buffer.from('not json'))
    vi.advanceTimersByTime(5000)
    expect(client.publish).not.toHaveBeenCalledWith('devices/device-1/responses', expect.anything(), expect.anything(), expect.anything())
    vi.useRealTimers()
  })

  it('publishes a FAILED response when the rng falls below the failure rate', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, failureRate: 1 }, client as unknown as MqttLike, { rng: () => 0.0 })
    sim.start()
    const command = { commandId: '123e4567-e89b-12d3-a456-426614174000', type: 'REBOOT' }
    client.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(command)))
    vi.advanceTimersByTime(500)
    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/responses',
      JSON.stringify({ commandId: '123e4567-e89b-12d3-a456-426614174000', status: 'FAILED' }),
      { qos: 1 },
      expect.any(Function),
    )
    vi.useRealTimers()
  })

  it('on stop, publishes an offline status then ends the client', () => {
    const sim = new DeviceSimulator(config, client as unknown as MqttLike, { now: () => new Date('2026-07-07T11:00:00.000Z') })
    sim.stop()
    expect(client.publish).toHaveBeenCalledWith(
      'devices/device-1/status',
      JSON.stringify({ status: 'offline', timestamp: '2026-07-07T11:00:00.000Z' }),
      { qos: 1, retain: true },
      expect.any(Function),
    )
    expect(client.end).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/device-simulator/src/simulator.spec.ts`
Expected: FAIL, module `./simulator` not found.

- [ ] **Step 3: Implement the simulator runtime**

`apps/device-simulator/src/simulator.ts`:
```typescript
import type { IClientOptions } from 'mqtt'
import type { SimulatorConfig } from './config'
import {
  commandsTopic,
  responsesTopic,
  statusTopic,
  parseCommand,
  buildStatusMessage,
  buildResponseMessage,
  decideResponseStatus,
} from './messages'

export interface MqttLike {
  publish(topic: string, payload: string, opts: { qos: 0 | 1 | 2; retain?: boolean }, cb?: (err?: Error) => void): void
  subscribe(topic: string, opts: { qos: 0 | 1 | 2 }, cb?: (err: Error | null) => void): void
  on(event: 'connect' | 'message' | 'error', handler: (...args: any[]) => void): void
  end(force?: boolean): void
}

interface SimulatorDeps {
  now?: () => Date
  rng?: () => number
  setTimeout?: typeof setTimeout
}

export function buildConnectOptions(config: SimulatorConfig): IClientOptions {
  return {
    username: config.username,
    password: config.password,
    will: {
      topic: statusTopic(config.externalId),
      payload: Buffer.from(JSON.stringify(buildStatusMessage('offline'))),
      qos: config.qos,
      retain: true,
    },
  }
}

export class DeviceSimulator {
  private readonly now: () => Date
  private readonly rng: () => number
  private readonly timer: typeof setTimeout

  constructor(
    private readonly config: SimulatorConfig,
    private readonly client: MqttLike,
    deps: SimulatorDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date())
    this.rng = deps.rng ?? Math.random
    this.timer = deps.setTimeout ?? setTimeout
  }

  start(): void {
    this.client.on('connect', () => this.handleConnect())
    this.client.on('message', (topic: string, payload: Buffer) => this.handleMessage(topic, payload))
    this.client.on('error', (err: Error) => console.error(`[simulator] erro de conexão MQTT: ${err.message}`))
  }

  stop(): void {
    this.publishStatus('offline')
    this.client.end()
  }

  private handleConnect(): void {
    console.log(`[simulator] conectado como ${this.config.externalId}`)
    this.publishStatus('online')
    this.client.subscribe(commandsTopic(this.config.externalId), { qos: this.config.qos }, (err) => {
      if (err) console.error(`[simulator] falha ao assinar comandos: ${err.message}`)
    })
  }

  private handleMessage(_topic: string, payload: Buffer): void {
    const command = parseCommand(payload)
    if (!command) {
      console.warn(`[simulator] comando inválido descartado: ${payload.toString()}`)
      return
    }
    console.log(`[simulator] comando recebido ${command.commandId} (${command.type})`)
    this.timer(() => {
      const status = decideResponseStatus(this.config.failureRate, this.rng)
      const message = buildResponseMessage(command.commandId, status)
      this.client.publish(responsesTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos }, (err) => {
        if (err) console.error(`[simulator] falha ao publicar resposta: ${err.message}`)
      })
      console.log(`[simulator] resposta ${status} enviada para ${command.commandId}`)
    }, this.config.responseDelayMs)
  }

  private publishStatus(status: 'online' | 'offline'): void {
    const message = buildStatusMessage(status, this.now())
    this.client.publish(statusTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos, retain: true }, (err) => {
      if (err) console.error(`[simulator] falha ao publicar status ${status}: ${err.message}`)
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/device-simulator/src/simulator.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/simulator.ts apps/device-simulator/src/simulator.spec.ts
git commit -m "feat(simulator): add DeviceSimulator runtime with LWT, delayed responses"
```

---

### Task 5: Entrypoint & Graceful Shutdown

**Files:**
- Modify: `apps/device-simulator/src/index.ts` (replace the placeholder from Task 1)

**Interfaces:**
- Consumes: `loadSimulatorConfig` (Task 2), `buildConnectOptions` + `DeviceSimulator` (Task 4), `mqtt.connect`.
- Produces: the runnable entrypoint (`node dist/index.js`). No exported symbols.

- [ ] **Step 1: Implement the entrypoint**

`apps/device-simulator/src/index.ts` (replace the placeholder entirely):
```typescript
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
    simulator.stop()
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
```

- [ ] **Step 2: Build and verify it starts without a broker error path**

Run:
```bash
pnpm --filter @mqtt-poc/device-simulator build
```
Expected: `tsc` completes with no TypeScript errors, `apps/device-simulator/dist/index.js` created.

- [ ] **Step 3: Verify config-error exit works (no valid env)**

Run: `env -i PATH="$PATH" node apps/device-simulator/dist/index.js`
Expected: process exits non-zero with an uncaught `Error: MQTT_URL não configurada` (proves config validation runs at startup). This is the expected failure — no `.env` is loaded by the simulator itself; env must be provided by the shell/`.env` export or the manual run in Step 4.

- [ ] **Step 4: Manual smoke test against local Mosquitto**

Run (Mosquitto must be up via `docker compose up -d mosquitto`):
```bash
docker compose up -d mosquitto
docker compose exec -T mosquitto mosquitto_sub -t "devices/device-001/status" -C 1 &
MQTT_URL=mqtt://localhost:1883 DEVICE_EXTERNAL_ID=device-001 node apps/device-simulator/dist/index.js &
SIM_PID=$!
sleep 1
docker compose exec -T mosquitto mosquitto_pub -t "devices/device-001/commands" -m '{"commandId":"123e4567-e89b-12d3-a456-426614174000","type":"REBOOT"}'
docker compose exec -T mosquitto mosquitto_sub -t "devices/device-001/responses" -C 1
kill $SIM_PID
```
Expected: the first `mosquitto_sub` prints the retained `{"status":"online",...}`; after publishing the command, the second `mosquitto_sub` prints `{"commandId":"123e4567-e89b-12d3-a456-426614174000","status":"ACKED"}` (after ~1s delay).

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/index.ts
git commit -m "feat(simulator): add entrypoint with graceful shutdown"
```

---

### Task 6: End-to-End Integration Test (simulator ↔ API via broker)

**Files:**
- Create: `apps/device-simulator/src/simulator.integration.spec.ts`

**Interfaces:**
- Consumes: `DeviceSimulator` + `buildConnectOptions` (Task 4), `loadSimulatorConfig` (Task 2), the real `mqtt` client, and the real API `AppModule` + `createMqttMicroserviceOptions` + `PrismaService` from `apps/api` (imported by relative path across the workspace).
- Produces: nothing (terminal verification task).

- [ ] **Step 1: Write the integration test**

`apps/device-simulator/src/simulator.integration.spec.ts`:
```typescript
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mqtt from 'mqtt'
import { PrismaService } from '../../api/src/shared/prisma/prisma.service'
import { DeviceSimulator, buildConnectOptions } from './simulator'
import type { SimulatorConfig } from './config'

function assertLocalIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    throw new Error('Testes de integração devem rodar contra um banco local (DATABASE_URL deve apontar para localhost).')
  }
}

describe('DeviceSimulator integration', () => {
  const runId = `sim-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const externalId = `device-${runId}`
  let app: INestApplication
  let moduleRef: TestingModule
  let prisma: PrismaService
  let baseUrl: string
  let simulator: DeviceSimulator
  let simClient: mqtt.MqttClient
  const deviceIds: string[] = []

  beforeAll(async () => {
    assertLocalIntegrationDatabase()
    process.env.MQTT_URL ??= 'mqtt://localhost:1883'

    const { AppModule } = await import('../../api/src/app.module')
    const { createMqttMicroserviceOptions } = await import('../../api/src/shared/mqtt/mqtt-microservice-options')

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.connectMicroservice(createMqttMicroserviceOptions())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.startAllMicroservices()
    await app.listen(0)

    prisma = app.get(PrismaService)
    baseUrl = await app.getUrl()

    const config: SimulatorConfig = {
      url: process.env.MQTT_URL as string,
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      qos: 1,
      externalId,
      responseDelayMs: 100,
      failureRate: 0,
    }
    simClient = mqtt.connect(config.url, buildConnectOptions(config))
    await new Promise<void>((resolve, reject) => {
      simClient.once('connect', () => resolve())
      simClient.once('error', reject)
    })
    simulator = new DeviceSimulator(config, simClient)
    simulator.start()
  }, 30000)

  afterAll(async () => {
    if (prisma && deviceIds.length) {
      await prisma.command.deleteMany({ where: { deviceId: { in: deviceIds } } })
      await prisma.device.deleteMany({ where: { id: { in: deviceIds } } })
    }
    simulator?.stop()
    simClient?.end(true)
    await app?.close()
    await moduleRef?.close()
  })

  it('registers a device, sends a command, and the simulator ACKs it end-to-end', async () => {
    const device = await prisma.device.create({ data: { externalId, name: `Sim ${runId}` } })
    deviceIds.push(device.id)

    const createRes = await fetch(`${baseUrl}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, type: 'REBOOT' }),
    })
    const created = (await createRes.json()) as { id: string; status: string }
    expect(created.status).toBe('PENDING')

    // poll until the simulator's response has been ingested by the API
    let finalStatus = created.status
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const res = await fetch(`${baseUrl}/commands/${created.id}`)
      finalStatus = ((await res.json()) as { status: string }).status
      if (finalStatus !== 'PENDING') break
    }
    expect(finalStatus).toBe('ACKED')
  }, 20000)
})
```

- [ ] **Step 2: Run the integration test with the full stack up**

Run:
```bash
docker compose up -d
until docker compose exec -T postgres pg_isready -U mqtt -d mqtt_poc; do sleep 1; done
pnpm prisma migrate deploy
pnpm test:integration
```
Expected: PASS — both the pre-existing `commands.integration.spec.ts` and the new `simulator.integration.spec.ts` (device registered, command sent, simulator ACKs it, API records `ACKED`).

- [ ] **Step 3: Run the full unit suite to confirm no regressions**

Run: `pnpm test`
Expected: PASS (all unit tests across `packages/shared`, `apps/api`, and `apps/device-simulator`).

- [ ] **Step 4: Commit**

```bash
git add apps/device-simulator/src/simulator.integration.spec.ts
git commit -m "test(simulator): add end-to-end integration test against the API"
```

---

## Self-Review Notes

- **Spec coverage** (against the "Simulador de dispositivo" section): standalone Node/TS script not a Nest app ✓ (Tasks 1, 5); config via the same env vars as the API + `--externalId` CLI override ✓ (Task 2); LWT `offline` on status topic + retained `online` on connect ✓ (Task 4 `buildConnectOptions`/`handleConnect`); subscribes commands topic ✓ (Task 4); delayed configurable response with ACKED/FAILED (random via `SIMULATOR_FAILURE_RATE`) ✓ (Tasks 3, 4); logs each command received and response sent ✓ (Task 4 `console.log`s); `pnpm --filter ... start -- --externalId=...` usage and multiple instances ✓ (Tasks 1, 2, 5 — each process reads its own externalId).
- **Placeholder scan:** no TBD/TODO; every code step contains complete code; the Task 1 `index.ts` placeholder is explicitly replaced in Task 5.
- **Type consistency:** `SimulatorConfig` fields (`url/username/password/qos/externalId/responseDelayMs/failureRate`) are identical across Tasks 2, 4, 6. Topic helper names (`commandsTopic`/`responsesTopic`/`statusTopic`), `parseCommand`, `buildStatusMessage`, `buildResponseMessage`, `decideResponseStatus` match between their definition (Task 3) and use (Task 4). `DeviceSimulator` constructor signature and `MqttLike`/`buildConnectOptions` match between Task 4 and Tasks 5/6.
- **Cross-workspace import note:** Task 6 imports `apps/api` source directly by relative path (`../../api/src/...`). This is the same real `AppModule` the API's own integration test boots; it relies on the root vitest SWC transform (added during the API work) that emits decorator metadata, and on `@mqtt-poc/shared` being built (root `postinstall`). Both are already in place from the API sub-project.
