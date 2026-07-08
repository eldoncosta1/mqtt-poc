# GPS Telemetry + Live Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GPS telemetry stream from each device simulator, ingest and persist it in the API, and render a live map with a moving marker + trail on the device detail page.

**Architecture:** The simulator publishes GPS points on a new MQTT topic `devices/{externalId}/telemetry` via a random walk. A new NestJS `telemetry` module (mirroring `commands`) validates, persists to a new `Telemetry` table, and emits a `telemetry.recorded` event that the existing `StatusGateway` broadcasts over WebSocket. The web app loads initial trail history via REST and appends live points onto a Leaflet map.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, MQTT (mqtt.js), Socket.IO, React 18, React Query, Leaflet + react-leaflet, Vitest, pnpm workspace.

## Global Constraints

- **Package manager:** pnpm workspace. Run a single test file with `pnpm -C apps/<app> exec vitest run <path>` (or `pnpm -C packages/shared ...`).
- **Leaflet version floor:** the web app is React 18.3 — use `react-leaflet@^4.2.1` and `leaflet@^1.9.4`. Do NOT install react-leaflet v5 (requires React 19).
- **MQTT delivery:** telemetry uses the shared QoS config value; it is **published without `retain`** (continuous stream, not state).
- **Timestamps:** `recordedAt` = the device-provided `timestamp`; the DB `createdAt` defaults to server receive time. Telemetry never touches `Device.lastSeenAt` / liveness.
- **Display window:** telemetry `limit` default is `100`, hard-capped at `500`.
- **Copy:** user-facing log/warn messages are in Portuguese, matching the existing code.
- **Discipline:** TDD (failing test first), one behavior per commit.

---

### Task 1: Shared GPS telemetry schema

**Files:**
- Modify: `packages/shared/src/schemas/mqtt.schema.ts`
- Test: `packages/shared/src/schemas/mqtt.schema.spec.ts`

**Interfaces:**
- Produces: `gpsTelemetryMessageSchema` (Zod), `type GpsTelemetryMessage = { lat: number; lon: number; timestamp: string }`, exported from `@mqtt-poc/shared`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/schemas/mqtt.schema.spec.ts`:

```ts
import { gpsTelemetryMessageSchema } from './mqtt.schema'

describe('gpsTelemetryMessageSchema', () => {
  it('parses a valid GPS telemetry message', () => {
    const result = gpsTelemetryMessageSchema.safeParse({
      lat: -23.55, lon: -46.63, timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects out-of-range latitude', () => {
    const result = gpsTelemetryMessageSchema.safeParse({ lat: 120, lon: 0, timestamp: new Date().toISOString() })
    expect(result.success).toBe(false)
  })

  it('rejects a missing timestamp', () => {
    const result = gpsTelemetryMessageSchema.safeParse({ lat: 0, lon: 0 })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/shared exec vitest run src/schemas/mqtt.schema.spec.ts`
Expected: FAIL — `gpsTelemetryMessageSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `packages/shared/src/schemas/mqtt.schema.ts`:

```ts
export const gpsTelemetryMessageSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timestamp: z.string().datetime(),
})
export type GpsTelemetryMessage = z.infer<typeof gpsTelemetryMessageSchema>
```

- [ ] **Step 4: Run test to verify it passes, then rebuild the package**

Run: `pnpm -C packages/shared exec vitest run src/schemas/mqtt.schema.spec.ts`
Expected: PASS.
Then: `pnpm -C packages/shared build`
Expected: build succeeds (so `apps/api` and `apps/device-simulator` see the new export).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/mqtt.schema.ts packages/shared/src/schemas/mqtt.schema.spec.ts
git commit -m "feat(shared): add GPS telemetry message schema"
```

---

### Task 2: Simulator GPS config

**Files:**
- Modify: `apps/device-simulator/src/config.ts`
- Modify: `apps/device-simulator/.env.example`
- Test: `apps/device-simulator/src/config.spec.ts`

**Interfaces:**
- Produces: `SimulatorConfig` gains `gpsEnabled: boolean`, `gpsIntervalMs: number`, `gpsStartLat: number`, `gpsStartLon: number`, `gpsStepDeg: number`.

- [ ] **Step 1: Write the failing test**

Append these tests inside the `describe('loadSimulatorConfig', ...)` block in `apps/device-simulator/src/config.spec.ts`:

```ts
  it('defaults GPS to enabled with São Paulo start and sensible step/interval', () => {
    const config = loadSimulatorConfig(baseEnv, [])
    expect(config).toMatchObject({
      gpsEnabled: true,
      gpsIntervalMs: 3000,
      gpsStartLat: -23.5505,
      gpsStartLon: -46.6333,
      gpsStepDeg: 0.0005,
    })
  })

  it('parses GPS env vars and lets SIMULATOR_GPS_ENABLED=false disable it', () => {
    const config = loadSimulatorConfig(
      { ...baseEnv, SIMULATOR_GPS_ENABLED: 'false', SIMULATOR_GPS_INTERVAL_MS: '5000', SIMULATOR_GPS_START_LAT: '10', SIMULATOR_GPS_START_LON: '20', SIMULATOR_GPS_STEP_DEG: '0.01' },
      [],
    )
    expect(config).toMatchObject({ gpsEnabled: false, gpsIntervalMs: 5000, gpsStartLat: 10, gpsStartLon: 20, gpsStepDeg: 0.01 })
  })

  it('throws when SIMULATOR_GPS_INTERVAL_MS is invalid', () => {
    expect(() => loadSimulatorConfig({ ...baseEnv, SIMULATOR_GPS_INTERVAL_MS: '-1' }, [])).toThrow('SIMULATOR_GPS_INTERVAL_MS inválido')
  })
```

Update the existing `'loads a valid config with defaults'` test's `toEqual({...})` to also include the five new fields (`gpsEnabled: true, gpsIntervalMs: 3000, gpsStartLat: -23.5505, gpsStartLon: -46.6333, gpsStepDeg: 0.0005`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/device-simulator exec vitest run src/config.spec.ts`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Implement the config fields**

In `apps/device-simulator/src/config.ts`, add to the `SimulatorConfig` interface:

```ts
  gpsEnabled: boolean
  gpsIntervalMs: number
  gpsStartLat: number
  gpsStartLon: number
  gpsStepDeg: number
```

In `loadSimulatorConfig`, before the `return`, add:

```ts
  const gpsEnabled = (env.SIMULATOR_GPS_ENABLED ?? 'true') !== 'false'

  const gpsIntervalMs = Number(env.SIMULATOR_GPS_INTERVAL_MS ?? '3000')
  if (Number.isNaN(gpsIntervalMs) || gpsIntervalMs < 0) {
    throw new Error(`SIMULATOR_GPS_INTERVAL_MS inválido: ${env.SIMULATOR_GPS_INTERVAL_MS}. Deve ser >= 0 (0 desliga o GPS).`)
  }

  const gpsStartLat = Number(env.SIMULATOR_GPS_START_LAT ?? '-23.5505')
  const gpsStartLon = Number(env.SIMULATOR_GPS_START_LON ?? '-46.6333')
  const gpsStepDeg = Number(env.SIMULATOR_GPS_STEP_DEG ?? '0.0005')
```

Add the five fields to the returned object:

```ts
    gpsEnabled,
    gpsIntervalMs,
    gpsStartLat,
    gpsStartLon,
    gpsStepDeg,
```

- [ ] **Step 4: Add docs to `.env.example`**

Append to `apps/device-simulator/.env.example`:

```
# Liga/desliga a publicação de telemetria GPS (false desliga)
SIMULATOR_GPS_ENABLED=true
# Intervalo (ms) entre publicações de posição GPS (0 desliga o GPS)
SIMULATOR_GPS_INTERVAL_MS=3000
# Coordenada inicial do passeio aleatório (latitude)
SIMULATOR_GPS_START_LAT=-23.5505
# Coordenada inicial do passeio aleatório (longitude)
SIMULATOR_GPS_START_LON=-46.6333
# Tamanho máximo (graus) de cada passo do passeio aleatório
SIMULATOR_GPS_STEP_DEG=0.0005
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/device-simulator exec vitest run src/config.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/device-simulator/src/config.ts apps/device-simulator/src/config.spec.ts apps/device-simulator/.env.example
git commit -m "feat(simulator): add GPS telemetry config"
```

---

### Task 3: Simulator GPS pure module

**Files:**
- Create: `apps/device-simulator/src/gps.ts`
- Test: `apps/device-simulator/src/gps.spec.ts`

**Interfaces:**
- Consumes: `GpsTelemetryMessage` from `@mqtt-poc/shared`.
- Produces:
  - `telemetryTopic(externalId: string): string`
  - `nextPosition(current: { lat: number; lon: number }, stepDeg: number, rng?: () => number): { lat: number; lon: number }`
  - `initialPosition(startLat: number, startLon: number, rng?: () => number): { lat: number; lon: number }`
  - `buildTelemetryMessage(lat: number, lon: number, now?: Date): GpsTelemetryMessage`

- [ ] **Step 1: Write the failing test**

Create `apps/device-simulator/src/gps.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { telemetryTopic, nextPosition, initialPosition, buildTelemetryMessage } from './gps'

describe('telemetryTopic', () => {
  it('builds the per-device telemetry topic', () => {
    expect(telemetryTopic('device-1')).toBe('devices/device-1/telemetry')
  })
})

describe('nextPosition', () => {
  it('steps lat/lon by a delta within +/- stepDeg (rng=0.5 => no movement)', () => {
    const result = nextPosition({ lat: 10, lon: 20 }, 0.001, () => 0.5)
    expect(result).toEqual({ lat: 10, lon: 20 })
  })

  it('steps to the positive edge when rng=1', () => {
    const result = nextPosition({ lat: 10, lon: 20 }, 0.001, () => 1)
    expect(result.lat).toBeCloseTo(10.001, 6)
    expect(result.lon).toBeCloseTo(20.001, 6)
  })

  it('clamps latitude to [-90, 90]', () => {
    const result = nextPosition({ lat: 89.9995, lon: 0 }, 0.001, () => 1)
    expect(result.lat).toBeLessThanOrEqual(90)
  })
})

describe('initialPosition', () => {
  it('returns the base coordinate when rng=0.5 (no offset)', () => {
    expect(initialPosition(-23.5, -46.6, () => 0.5)).toEqual({ lat: -23.5, lon: -46.6 })
  })
})

describe('buildTelemetryMessage', () => {
  it('builds a message with lat, lon and an ISO timestamp', () => {
    const msg = buildTelemetryMessage(1.5, 2.5, new Date('2026-07-08T10:00:00.000Z'))
    expect(msg).toEqual({ lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/device-simulator exec vitest run src/gps.spec.ts`
Expected: FAIL — module `./gps` not found.

- [ ] **Step 3: Implement `gps.ts`**

Create `apps/device-simulator/src/gps.ts`:

```ts
import type { GpsTelemetryMessage } from '@mqtt-poc/shared'

const INITIAL_SPREAD_DEG = 0.02 // devices começam espalhados num raio pequeno

export const telemetryTopic = (externalId: string): string => `devices/${externalId}/telemetry`

const clampLat = (v: number): number => Math.min(90, Math.max(-90, v))
const clampLon = (v: number): number => Math.min(180, Math.max(-180, v))

export function nextPosition(
  current: { lat: number; lon: number },
  stepDeg: number,
  rng: () => number = Math.random,
): { lat: number; lon: number } {
  const dLat = (rng() * 2 - 1) * stepDeg
  const dLon = (rng() * 2 - 1) * stepDeg
  return { lat: clampLat(current.lat + dLat), lon: clampLon(current.lon + dLon) }
}

export function initialPosition(
  startLat: number,
  startLon: number,
  rng: () => number = Math.random,
): { lat: number; lon: number } {
  const dLat = (rng() * 2 - 1) * INITIAL_SPREAD_DEG
  const dLon = (rng() * 2 - 1) * INITIAL_SPREAD_DEG
  return { lat: clampLat(startLat + dLat), lon: clampLon(startLon + dLon) }
}

export function buildTelemetryMessage(lat: number, lon: number, now: Date = new Date()): GpsTelemetryMessage {
  return { lat, lon, timestamp: now.toISOString() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/device-simulator exec vitest run src/gps.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/gps.ts apps/device-simulator/src/gps.spec.ts
git commit -m "feat(simulator): add GPS random-walk pure module"
```

---

### Task 4: Simulator GPS publishing loop

**Files:**
- Modify: `apps/device-simulator/src/simulator.ts`
- Test: `apps/device-simulator/src/simulator.spec.ts`

**Interfaces:**
- Consumes: `telemetryTopic`, `nextPosition`, `initialPosition`, `buildTelemetryMessage` from `./gps`; GPS config fields from Task 2.
- Produces: `DeviceSimulator` publishes to `devices/{externalId}/telemetry` on connect and every `gpsIntervalMs`; stopped by `stop()`.

- [ ] **Step 1: Write the failing test**

Add to `apps/device-simulator/src/simulator.spec.ts` (the shared `config` object there has `heartbeatMs: 0`; GPS fields must be present — extend it). First extend the top-level `config` to include GPS defaults so existing tests keep GPS off:

```ts
// add to the `config` object:
  gpsEnabled: false,
  gpsIntervalMs: 0,
  gpsStartLat: -23.5,
  gpsStartLon: -46.6,
  gpsStepDeg: 0.001,
```

Then add a new `describe`:

```ts
describe('DeviceSimulator GPS telemetry', () => {
  let client: ReturnType<typeof makeFakeClient>
  beforeEach(() => { client = makeFakeClient() })

  const gpsConfig = { ...config, gpsEnabled: true, gpsIntervalMs: 3000 }

  const telemetryPublishes = (c: ReturnType<typeof makeFakeClient>) =>
    c.publish.mock.calls.filter((call) => call[0] === 'devices/device-1/telemetry').length

  it('on connect, publishes a telemetry point and keeps publishing on the interval', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    expect(telemetryPublishes(client)).toBe(1) // primeiro ponto no connect
    vi.advanceTimersByTime(3000)
    expect(telemetryPublishes(client)).toBe(2)
    vi.advanceTimersByTime(3000)
    expect(telemetryPublishes(client)).toBe(3)
    vi.useRealTimers()
  })

  it('does not publish telemetry when GPS is disabled', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...config, gpsEnabled: false }, client as unknown as MqttLike)
    sim.start()
    client.emit('connect')
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0)
    vi.useRealTimers()
  })

  it('stops the GPS loop on stop', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sim.stop()
    const after = telemetryPublishes(client)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(after)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/device-simulator exec vitest run src/simulator.spec.ts`
Expected: FAIL — no telemetry published.

- [ ] **Step 3: Implement the GPS loop in `simulator.ts`**

Add imports:

```ts
import {
  commandsTopic, responsesTopic, statusTopic,
  parseCommand, buildStatusMessage, buildResponseMessage, decideResponseStatus,
} from './messages'
import { telemetryTopic, nextPosition, initialPosition, buildTelemetryMessage } from './gps'
```

Add fields to the class:

```ts
  private gps?: ReturnType<typeof setInterval>
  private position: { lat: number; lon: number }
```

In the constructor body (after the `deps` assignments), initialize the position:

```ts
    this.position = initialPosition(config.gpsStartLat, config.gpsStartLon, this.rng)
```

In `handleConnect()`, after `this.startHeartbeat()`, add:

```ts
    this.startGps()
```

In `stop()`, before `this.publishStatus('offline')`, add:

```ts
    this.stopGps()
```

Add the methods:

```ts
  private startGps(): void {
    this.stopGps() // idempotente — evita loops duplicados numa reconexão
    if (!this.config.gpsEnabled || this.config.gpsIntervalMs <= 0) return
    this.publishTelemetry() // primeiro ponto imediato
    this.gps = this.interval(() => this.publishTelemetry(), this.config.gpsIntervalMs)
  }

  private stopGps(): void {
    if (this.gps) {
      this.clearTimer(this.gps)
      this.gps = undefined
    }
  }

  private publishTelemetry(): void {
    this.position = nextPosition(this.position, this.config.gpsStepDeg, this.rng)
    const message = buildTelemetryMessage(this.position.lat, this.position.lon, this.now())
    this.client.publish(telemetryTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos }, (err) => {
      if (err) console.error(`[simulator] falha ao publicar telemetria: ${err.message}`)
    })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/device-simulator exec vitest run`
Expected: PASS (all simulator specs, including the updated existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/device-simulator/src/simulator.ts apps/device-simulator/src/simulator.spec.ts
git commit -m "feat(simulator): publish GPS telemetry on connect and interval"
```

---

### Task 5: Telemetry Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma `Telemetry` model + generated `@prisma/client` `Telemetry` type; `Device.telemetry` relation.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, add to the `Device` model (after the `commands Command[]` line):

```prisma
  telemetry Telemetry[]                            // pontos de telemetria GPS deste dispositivo
```

Add a new model at the end of the file:

```prisma
model Telemetry {
  id         String   @id @default(uuid())        // identificador do ponto de telemetria
  deviceId   String                                // FK interna para Device.id
  lat        Float                                 // latitude reportada pelo dispositivo
  lon        Float                                 // longitude reportada pelo dispositivo
  recordedAt DateTime                              // timestamp informado pelo dispositivo
  createdAt  DateTime @default(now())              // hora de recepção no servidor

  device Device @relation(fields: [deviceId], references: [id]) // dispositivo dono deste ponto

  @@index([deviceId, recordedAt])
}
```

- [ ] **Step 2: Generate the migration and client**

Run (from repo root, DB must be running): `pnpm exec prisma migrate dev --name add_telemetry`
Expected: a new migration is created under `prisma/migrations/*_add_telemetry/` and the client is regenerated.

- [ ] **Step 3: Verify the client type exists**

Run: `pnpm -C apps/api exec tsc --noEmit`
Expected: PASS (no type errors; `Telemetry` importable from `@prisma/client`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(telemetry): add Telemetry Prisma model and migration"
```

---

### Task 6: Telemetry repository

**Files:**
- Create: `apps/api/src/modules/telemetry/domain/telemetry.repository.ts`
- Create: `apps/api/src/modules/telemetry/infrastructure/prisma-telemetry.repository.ts`
- Test: `apps/api/src/modules/telemetry/infrastructure/prisma-telemetry.repository.spec.ts`

**Interfaces:**
- Produces:
  - `TELEMETRY_REPOSITORY` (Symbol) and interface `TelemetryRepository`:
    - `findDeviceByExternalId(externalId: string): Promise<{ id: string; externalId: string } | null>`
    - `create(data: { deviceId: string; lat: number; lon: number; recordedAt: Date }): Promise<void>`
    - `listByDevice(deviceId: string, limit: number): Promise<Array<{ lat: number; lon: number; recordedAt: Date }>>`
  - `PrismaTelemetryRepository` implementing it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/telemetry/infrastructure/prisma-telemetry.repository.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrismaTelemetryRepository } from './prisma-telemetry.repository'

function makePrisma() {
  return {
    device: { findUnique: vi.fn() },
    telemetry: { create: vi.fn(), findMany: vi.fn() },
  }
}

describe('PrismaTelemetryRepository', () => {
  let prisma: ReturnType<typeof makePrisma>
  let repo: PrismaTelemetryRepository

  beforeEach(() => {
    prisma = makePrisma()
    repo = new PrismaTelemetryRepository(prisma as never)
  })

  it('findDeviceByExternalId selects id and externalId', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    const result = await repo.findDeviceByExternalId('device-1')
    expect(prisma.device.findUnique).toHaveBeenCalledWith({ where: { externalId: 'device-1' }, select: { id: true, externalId: true } })
    expect(result).toEqual({ id: 'd1', externalId: 'device-1' })
  })

  it('create inserts a telemetry row', async () => {
    const recordedAt = new Date('2026-07-08T10:00:00.000Z')
    await repo.create({ deviceId: 'd1', lat: 1, lon: 2, recordedAt })
    expect(prisma.telemetry.create).toHaveBeenCalledWith({ data: { deviceId: 'd1', lat: 1, lon: 2, recordedAt } })
  })

  it('listByDevice queries the newest N and returns them ascending', async () => {
    prisma.telemetry.findMany.mockResolvedValue([
      { lat: 3, lon: 3, recordedAt: new Date('2026-07-08T10:02:00.000Z') },
      { lat: 2, lon: 2, recordedAt: new Date('2026-07-08T10:01:00.000Z') },
    ])
    const result = await repo.listByDevice('d1', 100)
    expect(prisma.telemetry.findMany).toHaveBeenCalledWith({
      where: { deviceId: 'd1' },
      orderBy: { recordedAt: 'desc' },
      take: 100,
      select: { lat: true, lon: true, recordedAt: true },
    })
    expect(result.map((p) => p.lat)).toEqual([2, 3]) // reversed to ascending
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/infrastructure/prisma-telemetry.repository.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the interface**

Create `apps/api/src/modules/telemetry/domain/telemetry.repository.ts`:

```ts
export interface TelemetryRepository {
  findDeviceByExternalId(externalId: string): Promise<{ id: string; externalId: string } | null>
  create(data: { deviceId: string; lat: number; lon: number; recordedAt: Date }): Promise<void>
  listByDevice(deviceId: string, limit: number): Promise<Array<{ lat: number; lon: number; recordedAt: Date }>>
}

export const TELEMETRY_REPOSITORY = Symbol('TELEMETRY_REPOSITORY')
```

- [ ] **Step 4: Implement the Prisma repository**

Create `apps/api/src/modules/telemetry/infrastructure/prisma-telemetry.repository.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../shared/prisma/prisma.service'
import { TelemetryRepository } from '../domain/telemetry.repository'

@Injectable()
export class PrismaTelemetryRepository implements TelemetryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDeviceByExternalId(externalId: string) {
    return this.prisma.device.findUnique({ where: { externalId }, select: { id: true, externalId: true } })
  }

  async create(data: { deviceId: string; lat: number; lon: number; recordedAt: Date }) {
    await this.prisma.telemetry.create({
      data: { deviceId: data.deviceId, lat: data.lat, lon: data.lon, recordedAt: data.recordedAt },
    })
  }

  async listByDevice(deviceId: string, limit: number) {
    const rows = await this.prisma.telemetry.findMany({
      where: { deviceId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
      select: { lat: true, lon: true, recordedAt: true },
    })
    return rows.reverse()
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/infrastructure/prisma-telemetry.repository.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/telemetry/domain apps/api/src/modules/telemetry/infrastructure
git commit -m "feat(telemetry): add telemetry repository"
```

---

### Task 7: RecordTelemetryUseCase

**Files:**
- Create: `apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.ts`
- Test: `apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.spec.ts`

**Interfaces:**
- Consumes: `TelemetryRepository`, `TELEMETRY_REPOSITORY`, `EventEmitter2`.
- Produces: `RecordTelemetryUseCase.execute(input: { externalId: string; lat: number; lon: number; timestamp: string }): Promise<void>`; emits event `telemetry.recorded` with `{ externalId, lat, lon, recordedAt: Date }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecordTelemetryUseCase } from './record-telemetry.use-case'

const mockRepo = { findDeviceByExternalId: vi.fn(), create: vi.fn(), listByDevice: vi.fn() }
const mockEvents = { emit: vi.fn() }

function makeUseCase() {
  return new RecordTelemetryUseCase(mockRepo as never, mockEvents as never)
}

const input = { externalId: 'device-1', lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' }

describe('RecordTelemetryUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the point and emits telemetry.recorded when the device exists', async () => {
    mockRepo.findDeviceByExternalId.mockResolvedValue({ id: 'd1', externalId: 'device-1' })
    await makeUseCase().execute(input)
    expect(mockRepo.create).toHaveBeenCalledWith({ deviceId: 'd1', lat: 1.5, lon: 2.5, recordedAt: new Date('2026-07-08T10:00:00.000Z') })
    expect(mockEvents.emit).toHaveBeenCalledWith('telemetry.recorded', {
      externalId: 'device-1', lat: 1.5, lon: 2.5, recordedAt: new Date('2026-07-08T10:00:00.000Z'),
    })
  })

  it('drops the point and emits nothing when the device is unknown', async () => {
    mockRepo.findDeviceByExternalId.mockResolvedValue(null)
    await makeUseCase().execute(input)
    expect(mockRepo.create).not.toHaveBeenCalled()
    expect(mockEvents.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/application/use-cases/record-telemetry.use-case.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the use case**

Create `apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TelemetryRepository, TELEMETRY_REPOSITORY } from '../../domain/telemetry.repository'

@Injectable()
export class RecordTelemetryUseCase {
  private readonly logger = new Logger(RecordTelemetryUseCase.name)

  constructor(
    @Inject(TELEMETRY_REPOSITORY) private readonly repo: TelemetryRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: { externalId: string; lat: number; lon: number; timestamp: string }): Promise<void> {
    const device = await this.repo.findDeviceByExternalId(input.externalId)
    if (!device) {
      this.logger.warn(`Telemetria recebida para dispositivo não cadastrado: ${input.externalId}`)
      return
    }

    const recordedAt = new Date(input.timestamp)
    await this.repo.create({ deviceId: device.id, lat: input.lat, lon: input.lon, recordedAt })
    this.events.emit('telemetry.recorded', {
      externalId: input.externalId, lat: input.lat, lon: input.lon, recordedAt,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/application/use-cases/record-telemetry.use-case.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.ts apps/api/src/modules/telemetry/application/use-cases/record-telemetry.use-case.spec.ts
git commit -m "feat(telemetry): add RecordTelemetryUseCase"
```

---

### Task 8: ListTelemetryUseCase

**Files:**
- Create: `apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.ts`
- Test: `apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.spec.ts`

**Interfaces:**
- Consumes: `TelemetryRepository`, `TELEMETRY_REPOSITORY`.
- Produces: `ListTelemetryUseCase.execute(deviceId: string, limit: number): Promise<Array<{ lat: number; lon: number; recordedAt: Date }>>`; clamps `limit` to `[1, 500]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ListTelemetryUseCase } from './list-telemetry.use-case'

const mockRepo = { findDeviceByExternalId: vi.fn(), create: vi.fn(), listByDevice: vi.fn() }

function makeUseCase() {
  return new ListTelemetryUseCase(mockRepo as never)
}

describe('ListTelemetryUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates to the repository with the requested limit', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 50)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 50)
  })

  it('caps the limit at 500', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 1000)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 500)
  })

  it('floors the limit at 1', async () => {
    mockRepo.listByDevice.mockResolvedValue([])
    await makeUseCase().execute('d1', 0)
    expect(mockRepo.listByDevice).toHaveBeenCalledWith('d1', 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/application/use-cases/list-telemetry.use-case.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the use case**

Create `apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import { TelemetryRepository, TELEMETRY_REPOSITORY } from '../../domain/telemetry.repository'

const MAX_LIMIT = 500

@Injectable()
export class ListTelemetryUseCase {
  constructor(@Inject(TELEMETRY_REPOSITORY) private readonly repo: TelemetryRepository) {}

  execute(deviceId: string, limit: number) {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
    return this.repo.listByDevice(deviceId, capped)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/application/use-cases/list-telemetry.use-case.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.ts apps/api/src/modules/telemetry/application/use-cases/list-telemetry.use-case.spec.ts
git commit -m "feat(telemetry): add ListTelemetryUseCase with limit clamp"
```

---

### Task 9: Telemetry MQTT listener

**Files:**
- Create: `apps/api/src/modules/telemetry/presentation/mqtt/telemetry.listener.ts`
- Test: `apps/api/src/modules/telemetry/presentation/mqtt/telemetry.listener.spec.ts`

**Interfaces:**
- Consumes: `RecordTelemetryUseCase`, `gpsTelemetryMessageSchema`.
- Produces: `TelemetryListener` handling `@EventPattern('devices/+/telemetry')`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/telemetry/presentation/mqtt/telemetry.listener.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelemetryListener } from './telemetry.listener'

const mockUseCase = { execute: vi.fn() }
const ctx = (topic: string) => ({ getTopic: () => topic }) as never

function makeListener() {
  return new TelemetryListener(mockUseCase as never)
}

describe('TelemetryListener', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a valid telemetry message with the externalId from the topic', async () => {
    const data = { lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' }
    await makeListener().handleTelemetry(data, ctx('devices/device-1/telemetry'))
    expect(mockUseCase.execute).toHaveBeenCalledWith({ externalId: 'device-1', lat: 1.5, lon: 2.5, timestamp: '2026-07-08T10:00:00.000Z' })
  })

  it('drops an invalid telemetry message', async () => {
    await makeListener().handleTelemetry({ lat: 999 }, ctx('devices/device-1/telemetry'))
    expect(mockUseCase.execute).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/presentation/mqtt/telemetry.listener.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the listener**

Create `apps/api/src/modules/telemetry/presentation/mqtt/telemetry.listener.ts`:

```ts
import { Controller, Logger } from '@nestjs/common'
import { Ctx, EventPattern, MqttContext, Payload } from '@nestjs/microservices'
import { gpsTelemetryMessageSchema } from '@mqtt-poc/shared'
import { RecordTelemetryUseCase } from '../../application/use-cases/record-telemetry.use-case'

@Controller()
export class TelemetryListener {
  private readonly logger = new Logger(TelemetryListener.name)

  constructor(private readonly recordTelemetry: RecordTelemetryUseCase) {}

  @EventPattern('devices/+/telemetry')
  async handleTelemetry(@Payload() data: unknown, @Ctx() context: MqttContext) {
    const externalId = context.getTopic().split('/')[1]
    const parsed = gpsTelemetryMessageSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(`Mensagem de telemetria inválida para ${externalId}: ${JSON.stringify(data)}`)
      return
    }
    await this.recordTelemetry.execute({ externalId, ...parsed.data })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/presentation/mqtt/telemetry.listener.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/telemetry/presentation/mqtt
git commit -m "feat(telemetry): add MQTT telemetry listener"
```

---

### Task 10: Telemetry REST controller + DTO

**Files:**
- Create: `apps/api/src/modules/telemetry/presentation/dtos/list-telemetry-query.dto.ts`
- Create: `apps/api/src/modules/telemetry/presentation/controllers/telemetry.controller.ts`
- Test: `apps/api/src/modules/telemetry/presentation/controllers/telemetry.controller.spec.ts`

**Interfaces:**
- Consumes: `ListTelemetryUseCase`.
- Produces: `GET /devices/:id/telemetry?limit=` → `Array<{ lat, lon, recordedAt }>`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/telemetry/presentation/controllers/telemetry.controller.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelemetryController } from './telemetry.controller'

const mockUseCase = { execute: vi.fn() }

function makeController() {
  return new TelemetryController(mockUseCase as never)
}

describe('TelemetryController', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists telemetry with the provided limit', async () => {
    mockUseCase.execute.mockResolvedValue([])
    await makeController().list('d1', { limit: 50 })
    expect(mockUseCase.execute).toHaveBeenCalledWith('d1', 50)
  })

  it('defaults the limit to 100 when omitted', async () => {
    mockUseCase.execute.mockResolvedValue([])
    await makeController().list('d1', {})
    expect(mockUseCase.execute).toHaveBeenCalledWith('d1', 100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/presentation/controllers/telemetry.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DTO**

Create `apps/api/src/modules/telemetry/presentation/dtos/list-telemetry-query.dto.ts`:

```ts
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min } from 'class-validator'

export class ListTelemetryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number
}
```

- [ ] **Step 4: Implement the controller**

Create `apps/api/src/modules/telemetry/presentation/controllers/telemetry.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ListTelemetryUseCase } from '../../application/use-cases/list-telemetry.use-case'
import { ListTelemetryQueryDto } from '../dtos/list-telemetry-query.dto'

@ApiTags('telemetry')
@Controller('devices')
export class TelemetryController {
  constructor(private readonly listTelemetry: ListTelemetryUseCase) {}

  @Get(':id/telemetry')
  list(@Param('id') id: string, @Query() query: ListTelemetryQueryDto) {
    return this.listTelemetry.execute(id, query.limit ?? 100)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/modules/telemetry/presentation/controllers/telemetry.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/telemetry/presentation/dtos apps/api/src/modules/telemetry/presentation/controllers
git commit -m "feat(telemetry): add telemetry REST controller"
```

---

### Task 11: Gateway telemetry broadcast

**Files:**
- Modify: `apps/api/src/shared/realtime/status.gateway.ts`
- Test: `apps/api/src/shared/realtime/status.gateway.spec.ts`

**Interfaces:**
- Consumes: `telemetry.recorded` event `{ externalId, lat, lon, recordedAt: Date }`.
- Produces: WebSocket emit `telemetry:point` `{ lat, lon, recordedAt }` to room `device:{externalId}`.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('StatusGateway', ...)` in `apps/api/src/shared/realtime/status.gateway.spec.ts` (reusing that file's existing `makeServer()` helper):

```ts
  it('emits telemetry:point to the device room when telemetry.recorded fires', () => {
    const gateway = new StatusGateway()
    const server = makeServer()
    gateway.server = server as any
    const recordedAt = new Date('2026-07-08T10:00:00.000Z')
    gateway.handleTelemetry({ externalId: 'device-1', lat: 1.5, lon: 2.5, recordedAt })
    expect(server.to).toHaveBeenCalledWith('device:device-1')
    expect(server.emit).toHaveBeenCalledWith('telemetry:point', { lat: 1.5, lon: 2.5, recordedAt })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run src/shared/realtime/status.gateway.spec.ts`
Expected: FAIL — `handleTelemetry` is not a function.

- [ ] **Step 3: Implement the handler**

In `apps/api/src/shared/realtime/status.gateway.ts`, add the interface near the others:

```ts
interface TelemetryRecordedEvent {
  externalId: string
  lat: number
  lon: number
  recordedAt: Date
}
```

Add the handler method to the class:

```ts
  @OnEvent('telemetry.recorded')
  handleTelemetry(event: TelemetryRecordedEvent) {
    this.server.to(`device:${event.externalId}`).emit('telemetry:point', {
      lat: event.lat, lon: event.lon, recordedAt: event.recordedAt,
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run src/shared/realtime/status.gateway.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shared/realtime/status.gateway.ts apps/api/src/shared/realtime/status.gateway.spec.ts
git commit -m "feat(telemetry): broadcast telemetry points over WebSocket"
```

---

### Task 12: Wire the telemetry module

**Files:**
- Create: `apps/api/src/modules/telemetry/telemetry.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: all telemetry providers/controllers from Tasks 6–10.
- Produces: `TelemetryModule` registered in `AppModule`; API builds and boots.

- [ ] **Step 1: Create the module**

Create `apps/api/src/modules/telemetry/telemetry.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { PrismaService } from '../../shared/prisma/prisma.service'
import { TELEMETRY_REPOSITORY } from './domain/telemetry.repository'
import { PrismaTelemetryRepository } from './infrastructure/prisma-telemetry.repository'
import { RecordTelemetryUseCase } from './application/use-cases/record-telemetry.use-case'
import { ListTelemetryUseCase } from './application/use-cases/list-telemetry.use-case'
import { TelemetryController } from './presentation/controllers/telemetry.controller'
import { TelemetryListener } from './presentation/mqtt/telemetry.listener'

@Module({
  providers: [
    PrismaService,
    { provide: TELEMETRY_REPOSITORY, useClass: PrismaTelemetryRepository },
    RecordTelemetryUseCase,
    ListTelemetryUseCase,
  ],
  controllers: [TelemetryController, TelemetryListener],
})
export class TelemetryModule {}
```

- [ ] **Step 2: Register it in `AppModule`**

In `apps/api/src/app.module.ts`, add the import and include it in `imports`:

```ts
import { TelemetryModule } from './modules/telemetry/telemetry.module'
```

Add `TelemetryModule,` to the `imports` array (after `CommandsModule,`).

- [ ] **Step 3: Verify the API builds**

Run: `pnpm -C apps/api build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Run the full API test suite**

Run: `pnpm -C apps/api exec vitest run`
Expected: PASS (all existing + new telemetry specs).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/telemetry/telemetry.module.ts apps/api/src/app.module.ts
git commit -m "feat(telemetry): wire telemetry module into the API"
```

---

### Task 13: Web telemetry API client

**Files:**
- Modify: `apps/web/package.json` (add deps)
- Modify: `apps/web/src/api/types.ts`
- Create: `apps/web/src/api/telemetry.ts`
- Test: `apps/web/src/api/telemetry.test.ts`

**Interfaces:**
- Produces: `type TelemetryPoint = { lat: number; lon: number; recordedAt: string }`; `telemetryApi.list(deviceId: string, limit?: number): Promise<TelemetryPoint[]>`.

- [ ] **Step 1: Add the map dependencies**

Run:
```bash
pnpm -C apps/web add leaflet@^1.9.4 react-leaflet@^4.2.1
pnpm -C apps/web add -D @types/leaflet@^1.9.12
```
Expected: `apps/web/package.json` now lists `leaflet`, `react-leaflet`, and dev `@types/leaflet`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/api/telemetry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './client'
import { telemetryApi } from './telemetry'

describe('telemetryApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /devices/:id/telemetry with the limit param', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ lat: 1, lon: 2, recordedAt: 'x' }] })
    const result = await telemetryApi.list('d1', 50)
    expect(api.get).toHaveBeenCalledWith('/devices/d1/telemetry', { params: { limit: 50 } })
    expect(result).toEqual([{ lat: 1, lon: 2, recordedAt: 'x' }])
  })

  it('list() defaults the limit to 100', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] })
    await telemetryApi.list('d1')
    expect(api.get).toHaveBeenCalledWith('/devices/d1/telemetry', { params: { limit: 100 } })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/api/telemetry.test.ts`
Expected: FAIL — module `./telemetry` not found.

- [ ] **Step 4: Add the type and client**

Append to `apps/web/src/api/types.ts`:

```ts
export interface TelemetryPoint {
  lat: number
  lon: number
  recordedAt: string
}
```

Create `apps/web/src/api/telemetry.ts`:

```ts
import { api } from './client'
import type { TelemetryPoint } from './types'

export const telemetryApi = {
  list: (deviceId: string, limit = 100) =>
    api.get<TelemetryPoint[]>(`/devices/${deviceId}/telemetry`, { params: { limit } }).then((r) => r.data),
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/api/telemetry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/api/types.ts apps/web/src/api/telemetry.ts apps/web/src/api/telemetry.test.ts
git commit -m "feat(web): add telemetry API client and Leaflet deps"
```

(The pnpm workspace lockfile lives at the repo root — `pnpm-lock.yaml` — not under `apps/web`.)

---

### Task 14: Web telemetry merge helper

**Files:**
- Modify: `apps/web/src/realtime/merge.ts`
- Test: `apps/web/src/realtime/merge.test.ts`

**Interfaces:**
- Consumes: `TelemetryPoint` from `../api/types`.
- Produces: `appendTelemetryPoint(points: TelemetryPoint[], point: TelemetryPoint, cap: number): TelemetryPoint[]`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/realtime/merge.test.ts`:

```ts
import { appendTelemetryPoint } from './merge'
import type { TelemetryPoint } from '../api/types'

const pt = (lat: number): TelemetryPoint => ({ lat, lon: 0, recordedAt: `t${lat}` })

describe('appendTelemetryPoint', () => {
  it('appends a point to the end', () => {
    expect(appendTelemetryPoint([pt(1)], pt(2), 10)).toEqual([pt(1), pt(2)])
  })

  it('drops the oldest points beyond the cap', () => {
    const result = appendTelemetryPoint([pt(1), pt(2), pt(3)], pt(4), 3)
    expect(result).toEqual([pt(2), pt(3), pt(4)])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/realtime/merge.test.ts`
Expected: FAIL — `appendTelemetryPoint` not exported.

- [ ] **Step 3: Implement the helper**

In `apps/web/src/realtime/merge.ts`, update the import line to include `TelemetryPoint`:

```ts
import type { Command, CommandStatus, Device, DeviceStatus, TelemetryPoint } from '../api/types'
```

Append:

```ts
export function appendTelemetryPoint(points: TelemetryPoint[], point: TelemetryPoint, cap: number): TelemetryPoint[] {
  return [...points, point].slice(-cap)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/realtime/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/realtime/merge.ts apps/web/src/realtime/merge.test.ts
git commit -m "feat(web): add appendTelemetryPoint merge helper"
```

---

### Task 15: Web realtime telemetry handler

**Files:**
- Modify: `apps/web/src/realtime/useDeviceRealtime.ts`
- Test: `apps/web/src/realtime/useDeviceRealtime.test.tsx`

**Interfaces:**
- Consumes: `TelemetryPoint` from `../api/types`.
- Produces: `DeviceRealtimeHandlers` gains `onTelemetry?: (point: TelemetryPoint) => void`, wired to the `telemetry:point` socket event.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/realtime/useDeviceRealtime.test.tsx`, inside the `describe`:

```ts
  it('forwards telemetry:point to the onTelemetry handler', () => {
    const onTelemetry = vi.fn()
    render(<Harness externalId="device-1" handlers={{ onTelemetry }} />)
    socketHandlers['telemetry:point']({ lat: 1.5, lon: 2.5, recordedAt: '2026-07-08T10:00:00.000Z' })
    expect(onTelemetry).toHaveBeenCalledWith({ lat: 1.5, lon: 2.5, recordedAt: '2026-07-08T10:00:00.000Z' })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/realtime/useDeviceRealtime.test.tsx`
Expected: FAIL — `telemetry:point` handler is not registered.

- [ ] **Step 3: Implement the handler**

In `apps/web/src/realtime/useDeviceRealtime.ts`:

Update the type import:

```ts
import type { CommandUpdate, DeviceStatusUpdate } from './merge'
import type { TelemetryPoint } from '../api/types'
```

Add to `DeviceRealtimeHandlers`:

```ts
  onTelemetry?: (point: TelemetryPoint) => void
```

Inside the `useEffect`, after the `device:status` handler:

```ts
    socket.on('telemetry:point', (point: TelemetryPoint) => handlersRef.current.onTelemetry?.(point))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/realtime/useDeviceRealtime.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/realtime/useDeviceRealtime.ts apps/web/src/realtime/useDeviceRealtime.test.tsx
git commit -m "feat(web): forward telemetry points from the realtime socket"
```

---

### Task 16: Web DeviceMap component

**Files:**
- Create: `apps/web/src/components/DeviceMap.tsx`
- Test: `apps/web/src/components/DeviceMap.test.tsx`

**Interfaces:**
- Consumes: `TelemetryPoint` from `../api/types`.
- Produces: `DeviceMap({ points }: { points: TelemetryPoint[] })` — renders a Leaflet map with a `Polyline` trail and a `Marker` at the latest point; renders a placeholder when `points` is empty.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/DeviceMap.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeviceMap } from './DeviceMap'
import type { TelemetryPoint } from '../api/types'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile" />,
  Polyline: ({ positions }: any) => <div data-testid="polyline" data-count={positions.length} />,
  Marker: ({ position }: any) => <div data-testid="marker" data-pos={position.join(',')} />,
  useMap: () => ({ setView: vi.fn() }),
}))
vi.mock('leaflet', () => ({ default: { icon: () => ({}) } }))

const pts: TelemetryPoint[] = [
  { lat: 1, lon: 2, recordedAt: 't1' },
  { lat: 3, lon: 4, recordedAt: 't2' },
]

describe('DeviceMap', () => {
  it('renders a polyline over all points and a marker at the latest', () => {
    render(<DeviceMap points={pts} />)
    expect(screen.getByTestId('polyline').getAttribute('data-count')).toBe('2')
    expect(screen.getByTestId('marker').getAttribute('data-pos')).toBe('3,4')
  })

  it('renders a placeholder when there are no points', () => {
    render(<DeviceMap points={[]} />)
    expect(screen.queryByTestId('marker')).toBeNull()
    expect(screen.getByText(/sem telemetria/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/components/DeviceMap.test.tsx`
Expected: FAIL — module `./DeviceMap` not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/DeviceMap.tsx`:

```tsx
import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { TelemetryPoint } from '../api/types'

// react-leaflet não resolve os ícones default com bundlers; montamos um ícone explícito.
const deviceIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center)
  }, [center, map])
  return null
}

export function DeviceMap({ points }: { points: TelemetryPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
        Sem telemetria ainda para este dispositivo.
      </div>
    )
  }

  const positions = points.map((p) => [p.lat, p.lon] as [number, number])
  const latest = positions[positions.length - 1]

  return (
    <div className="h-80 overflow-hidden rounded-lg border border-gray-200">
      <MapContainer center={latest} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={positions} />
        <Marker position={latest} icon={deviceIcon} />
        <Recenter center={latest} />
      </MapContainer>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/components/DeviceMap.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/DeviceMap.tsx apps/web/src/components/DeviceMap.test.tsx
git commit -m "feat(web): add DeviceMap live trail component"
```

---

### Task 17: Wire the map into the device detail page

**Files:**
- Modify: `apps/web/src/pages/DeviceDetailPage.tsx`
- Test: `apps/web/src/pages/DeviceDetailPage.test.tsx`

**Interfaces:**
- Consumes: `telemetryApi.list`, `DeviceMap`, `appendTelemetryPoint`, `useDeviceRealtime`'s `onTelemetry`.
- Produces: the detail page loads the last 100 telemetry points, renders `DeviceMap`, and appends live points (capped at 100).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/pages/DeviceDetailPage.test.tsx`, add mocks near the top (after the existing `vi.mock` lines):

```ts
vi.mock('../api/telemetry')
vi.mock('../components/DeviceMap', () => ({
  DeviceMap: ({ points }: { points: unknown[] }) => <div data-testid="device-map" data-count={points.length} />,
}))
```

Add `import { telemetryApi } from '../api/telemetry'` to the imports.

Add these tests inside the `describe`:

```ts
  it('renders the map with the loaded telemetry history', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(telemetryApi.list).mockResolvedValue([
      { lat: 1, lon: 2, recordedAt: 't1' },
      { lat: 3, lon: 4, recordedAt: 't2' },
    ])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    const map = await screen.findByTestId('device-map')
    expect(map.getAttribute('data-count')).toBe('2')
  })

  it('appends a realtime telemetry point to the map', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(telemetryApi.list).mockResolvedValue([{ lat: 1, lon: 2, recordedAt: 't1' }])
    renderPage()
    await screen.findByTestId('device-map')

    const calls = vi.mocked(useDeviceRealtime).mock.calls
    const handlers = calls[calls.length - 1][1]
    act(() => {
      handlers.onTelemetry!({ lat: 5, lon: 6, recordedAt: 't2' })
    })
    await waitFor(() => expect(screen.getByTestId('device-map').getAttribute('data-count')).toBe('2'))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: FAIL — no `device-map` element / `onTelemetry` not provided.

- [ ] **Step 3: Implement the page changes**

In `apps/web/src/pages/DeviceDetailPage.tsx`:

Add imports:

```ts
import { telemetryApi } from '../api/telemetry'
import type { Command, Device, TelemetryPoint } from '../api/types'
import { DeviceMap } from '../components/DeviceMap'
import { applyCommandUpdate, applyDeviceStatus, appendTelemetryPoint } from '../realtime/merge'
```

(Replace the existing `import type { Command, Device }` and `merge` import lines with the above.)

Add a constant and the telemetry query near the other queries:

```ts
const TELEMETRY_LIMIT = 100
```

```ts
  const telemetryQuery = useQuery({
    queryKey: ['telemetry', id],
    queryFn: () => telemetryApi.list(id, TELEMETRY_LIMIT),
    enabled: !!id,
  })
  const telemetryPoints = telemetryQuery.data ?? []
```

Extend the `useDeviceRealtime` handlers with `onTelemetry`:

```ts
    onTelemetry: (point) => {
      queryClient.setQueryData<TelemetryPoint[]>(['telemetry', id], (old) =>
        appendTelemetryPoint(old ?? [], point, TELEMETRY_LIMIT),
      )
    },
```

Render the map above the command form (after the header `</div>`, before the `<form>`):

```tsx
      <div className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Localização</h2>
        <DeviceMap points={telemetryPoints} />
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full web suite and build**

Run: `pnpm -C apps/web exec vitest run`
Expected: PASS.
Run: `pnpm -C apps/web build`
Expected: build succeeds (Leaflet CSS/asset imports resolve under Vite).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/DeviceDetailPage.tsx apps/web/src/pages/DeviceDetailPage.test.tsx
git commit -m "feat(web): show live GPS map on the device detail page"
```

---

## End-to-End Verification (after all tasks)

- [ ] Start infra (broker + Postgres) and the three apps.
- [ ] Register a device via the web UI (e.g. `externalId: device-gps-1`).
- [ ] Start a simulator: `pnpm -C apps/device-simulator dev --externalId=device-gps-1` (GPS enabled by default).
- [ ] Open the device detail page → confirm the marker moves and the trail grows live (~every 3s).
- [ ] Reload the page → confirm the trail is restored from history (last 100 points).
- [ ] Set `SIMULATOR_GPS_ENABLED=false`, restart the simulator → confirm no new points arrive (map holds last history).
