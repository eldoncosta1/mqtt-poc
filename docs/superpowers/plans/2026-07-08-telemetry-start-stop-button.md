# Telemetry Start/Stop Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a device-detail-page button that starts/stops GPS telemetry collection by commanding the device (simulator); collection is off until the user clicks "Iniciar".

**Architecture:** Reuses the existing command pipeline end to end. The web button sends a `START_TELEMETRY`/`STOP_TELEMETRY` command via `commandsApi.create`; the simulator, on ACK, starts/stops its GPS publish loop. GPS no longer auto-starts on connect. No API or Prisma changes.

**Tech Stack:** TypeScript, NestJS (unchanged), mqtt.js, React 18 + React Query, Vitest, pnpm workspace.

## Global Constraints

- **Package manager:** pnpm workspace. Run web tests with `pnpm -C apps/web exec vitest run <path>`; run simulator/shared tests with `pnpm exec vitest run <path>` from the repo root (the `-C apps/<node-app>` form can report "no test files found").
- **Command type values (exact, must match across simulator + web):** `START_TELEMETRY` and `STOP_TELEMETRY`.
- **Default collection state:** OFF. The simulator does NOT start GPS on connect; it starts only on an ACKed `START_TELEMETRY` and stops on an ACKed `STOP_TELEMETRY`. The web button starts in the "Iniciar coleta" state (`collecting = false`).
- **Execute-then-ack semantics:** a telemetry-control command that resolves `FAILED` (rng < `failureRate`) must NOT change the GPS state.
- **Branch:** continue on `feat/gps-telemetry-live-map` (extends the unmerged telemetry feature).
- **Web decoupling:** the web app does not depend on `@mqtt-poc/shared` (it keeps its own `api/types.ts`); web gets a local copy of the two constants, mirroring that existing pattern.
- **Discipline:** TDD (failing test first), one behavior per commit. After changing `packages/shared`, rebuild it (`pnpm -C packages/shared build`).

---

### Task 1: Shared telemetry command-type constants

**Files:**
- Create: `packages/shared/src/commands.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/commands.spec.ts`

**Interfaces:**
- Produces: `TELEMETRY_START_COMMAND = 'START_TELEMETRY'`, `TELEMETRY_STOP_COMMAND = 'STOP_TELEMETRY'`, exported from `@mqtt-poc/shared`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/commands.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TELEMETRY_START_COMMAND, TELEMETRY_STOP_COMMAND } from './commands'

describe('telemetry command constants', () => {
  it('exposes the exact command type strings', () => {
    expect(TELEMETRY_START_COMMAND).toBe('START_TELEMETRY')
    expect(TELEMETRY_STOP_COMMAND).toBe('STOP_TELEMETRY')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/commands.spec.ts`
Expected: FAIL — module `./commands` not found.

- [ ] **Step 3: Create the constants module**

Create `packages/shared/src/commands.ts`:

```ts
// Tipos de comando que ligam/desligam a coleta de telemetria GPS no dispositivo.
export const TELEMETRY_START_COMMAND = 'START_TELEMETRY'
export const TELEMETRY_STOP_COMMAND = 'STOP_TELEMETRY'
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add below the existing export:

```ts
export * from './commands'
```

- [ ] **Step 5: Run test to verify it passes, then rebuild the package**

Run: `pnpm exec vitest run packages/shared/src/commands.spec.ts`
Expected: PASS.
Then: `pnpm -C packages/shared build`
Expected: build succeeds (so the simulator sees the new exports).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/commands.ts packages/shared/src/index.ts packages/shared/src/commands.spec.ts
git commit -m "feat(shared): add telemetry start/stop command-type constants"
```

---

### Task 2: Simulator — command-driven GPS start/stop

**Files:**
- Modify: `apps/device-simulator/src/simulator.ts`
- Modify: `apps/device-simulator/src/simulator.spec.ts`
- Modify: `apps/device-simulator/.env.example`
- Test: `apps/device-simulator/src/simulator.spec.ts`

**Interfaces:**
- Consumes: `TELEMETRY_START_COMMAND`, `TELEMETRY_STOP_COMMAND` from `@mqtt-poc/shared`; existing `startGps`/`stopGps`.
- Produces: `DeviceSimulator` no longer auto-starts GPS on connect; starts/stops it on ACKed telemetry-control commands.

- [ ] **Step 1: Replace the GPS test block with command-driven tests**

In `apps/device-simulator/src/simulator.spec.ts`, replace the entire existing `describe('DeviceSimulator GPS telemetry', ...)` block with:

```ts
describe('DeviceSimulator GPS telemetry (command-driven)', () => {
  let client: ReturnType<typeof makeFakeClient>
  beforeEach(() => { client = makeFakeClient() })

  const gpsConfig = { ...config, gpsEnabled: true, gpsIntervalMs: 3000 }
  const START = { commandId: '11111111-1111-1111-1111-111111111111', type: 'START_TELEMETRY' }
  const STOP = { commandId: '22222222-2222-2222-2222-222222222222', type: 'STOP_TELEMETRY' }

  const telemetryPublishes = (c: ReturnType<typeof makeFakeClient>) =>
    c.publish.mock.calls.filter((call) => call[0] === 'devices/device-1/telemetry').length

  const sendCommand = (c: ReturnType<typeof makeFakeClient>, cmd: unknown) =>
    c.emit('message', 'devices/device-1/commands', Buffer.from(JSON.stringify(cmd)))

  it('does not publish telemetry on connect (collection is command-driven)', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0)
    vi.useRealTimers()
  })

  it('starts publishing after a START_TELEMETRY command is ACKed', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    expect(telemetryPublishes(client)).toBe(0) // aguarda o ACK (responseDelayMs)
    vi.advanceTimersByTime(500) // ACK -> startGps -> primeiro ponto imediato
    expect(telemetryPublishes(client)).toBe(1)
    vi.advanceTimersByTime(3000)
    expect(telemetryPublishes(client)).toBe(2)
    vi.useRealTimers()
  })

  it('stops publishing after a STOP_TELEMETRY command is ACKed', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(500)
    sendCommand(client, STOP)
    vi.advanceTimersByTime(500) // ACK -> stopGps
    const afterStop = telemetryPublishes(client)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(afterStop) // nenhuma telemetria nova
    vi.useRealTimers()
  })

  it('does not start GPS when a START_TELEMETRY command FAILs', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...gpsConfig, failureRate: 1 }, client as unknown as MqttLike, { rng: () => 0.0 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0) // FAILED -> estado inalterado
    vi.useRealTimers()
  })

  it('does not start GPS on a START_TELEMETRY when SIMULATOR_GPS_ENABLED is false', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator({ ...gpsConfig, gpsEnabled: false }, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(0) // trava-mestra
    vi.useRealTimers()
  })

  it('stops the GPS loop on stop after it was started by command', () => {
    vi.useFakeTimers()
    const sim = new DeviceSimulator(gpsConfig, client as unknown as MqttLike, { rng: () => 0.5 })
    sim.start()
    client.emit('connect')
    sendCommand(client, START)
    vi.advanceTimersByTime(500)
    sim.stop()
    const afterStop = telemetryPublishes(client)
    vi.advanceTimersByTime(30000)
    expect(telemetryPublishes(client)).toBe(afterStop)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run apps/device-simulator/src/simulator.spec.ts`
Expected: FAIL — the "does not publish telemetry on connect" test fails because GPS currently auto-starts on connect; the START/STOP tests fail because commands don't yet control GPS.

- [ ] **Step 3: Remove GPS auto-start on connect**

In `apps/device-simulator/src/simulator.ts`, in `handleConnect()`, delete the line:

```ts
    this.startGps()
```

(Leave `startHeartbeat()` and the `subscribe(...)` call intact.)

- [ ] **Step 4: Handle telemetry-control commands**

In `apps/device-simulator/src/simulator.ts`, add the import (extend the existing `./messages` import group is not needed — add a new import line):

```ts
import { TELEMETRY_START_COMMAND, TELEMETRY_STOP_COMMAND } from '@mqtt-poc/shared'
```

In `handleMessage`, inside the `this.timer(() => { ... })` callback, apply the side effect right after the status is decided and before publishing the response:

```ts
    this.timer(() => {
      const status = decideResponseStatus(this.config.failureRate, this.rng)
      if (status === 'ACKED') {
        if (command.type === TELEMETRY_START_COMMAND) this.startGps()
        else if (command.type === TELEMETRY_STOP_COMMAND) this.stopGps()
      }
      const message = buildResponseMessage(command.commandId, status)
      this.client.publish(responsesTopic(this.config.externalId), JSON.stringify(message), { qos: this.config.qos }, (err) => {
        if (err) console.error(`[simulator] falha ao publicar resposta: ${err.message}`)
      })
      console.log(`[simulator] resposta ${status} enviada para ${command.commandId}`)
    }, this.config.responseDelayMs)
```

- [ ] **Step 5: Update the `.env.example` comment**

In `apps/device-simulator/.env.example`, replace the `SIMULATOR_GPS_ENABLED` comment line:

```
# Liga/desliga a publicação de telemetria GPS (false desliga)
```

with:

```
# Trava-mestra do GPS: a coleta é acionada por comando (START_TELEMETRY); false desabilita o GPS por completo (ignora o comando)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run apps/device-simulator/src/simulator.spec.ts`
Expected: PASS (all simulator specs, including the rewritten GPS block and the untouched heartbeat/command tests).

- [ ] **Step 7: Commit**

```bash
git add apps/device-simulator/src/simulator.ts apps/device-simulator/src/simulator.spec.ts apps/device-simulator/.env.example
git commit -m "feat(simulator): drive GPS telemetry by START/STOP commands, not auto-start"
```

---

### Task 3: Web — start/stop collection button

**Files:**
- Create: `apps/web/src/api/telemetryCommands.ts`
- Modify: `apps/web/src/pages/DeviceDetailPage.tsx`
- Test: `apps/web/src/pages/DeviceDetailPage.test.tsx`

**Interfaces:**
- Consumes: `commandsApi.create`.
- Produces: `TELEMETRY_START_COMMAND` / `TELEMETRY_STOP_COMMAND` (web-local); a toggle button on the detail page sending `START_TELEMETRY`/`STOP_TELEMETRY`.

- [ ] **Step 1: Add the web-local command-type constants**

Create `apps/web/src/api/telemetryCommands.ts` (a dedicated module — kept OUT of `commands.ts` because the page test does `vi.mock('../api/commands')`, and these constants must not be auto-mocked away):

```ts
// Espelho local de @mqtt-poc/shared (o app web é desacoplado do pacote shared).
export const TELEMETRY_START_COMMAND = 'START_TELEMETRY'
export const TELEMETRY_STOP_COMMAND = 'STOP_TELEMETRY'
```

- [ ] **Step 2: Write the failing tests**

In `apps/web/src/pages/DeviceDetailPage.test.tsx`, add these tests inside the `describe('DeviceDetailPage', ...)` block:

```ts
  it('renders the collection toggle as "Iniciar coleta" by default', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    renderPage()
    expect(await screen.findByRole('button', { name: /iniciar coleta/i })).toBeInTheDocument()
  })

  it('sends START_TELEMETRY and flips to "Parar coleta" when starting collection', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(commandsApi.create).mockResolvedValue({ ...command, id: 'c-start', type: 'START_TELEMETRY' })
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.click(screen.getByRole('button', { name: /iniciar coleta/i }))
    await waitFor(() => expect(commandsApi.create).toHaveBeenCalledWith({ deviceId: 'd1', type: 'START_TELEMETRY' }))
    expect(await screen.findByRole('button', { name: /parar coleta/i })).toBeInTheDocument()
  })

  it('sends STOP_TELEMETRY when stopping an active collection', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(commandsApi.create).mockResolvedValue({ ...command, id: 'c-stop', type: 'STOP_TELEMETRY' })
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.click(screen.getByRole('button', { name: /iniciar coleta/i }))
    await screen.findByRole('button', { name: /parar coleta/i })
    await userEvent.click(screen.getByRole('button', { name: /parar coleta/i }))
    await waitFor(() => expect(commandsApi.create).toHaveBeenLastCalledWith({ deviceId: 'd1', type: 'STOP_TELEMETRY' }))
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C apps/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: FAIL — no "Iniciar coleta" button exists yet.

- [ ] **Step 4: Add the toggle state, mutation, and button**

In `apps/web/src/pages/DeviceDetailPage.tsx`:

Add the constants import (leave the existing `import { commandsApi } from '../api/commands'` line as-is):

```ts
import { TELEMETRY_START_COMMAND, TELEMETRY_STOP_COMMAND } from '../api/telemetryCommands'
```

Add the collection state next to the other `useState` calls (near line 45):

```ts
  const [collecting, setCollecting] = useState(false)
```

Add a toggle mutation after the existing `createCommand` mutation:

```ts
  const toggleCollection = useMutation({
    mutationFn: (commandType: string) => commandsApi.create({ deviceId: id, type: commandType }),
    onSuccess: () => {
      setCollecting((c) => !c)
      queryClient.invalidateQueries({ queryKey: ['commands'] })
    },
  })

  const onToggleCollection = () => {
    toggleCollection.mutate(collecting ? TELEMETRY_STOP_COMMAND : TELEMETRY_START_COMMAND)
  }
```

Replace the existing "Localização" section header line so the button sits beside the heading. Change:

```tsx
      <div className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Localização</h2>
        <DeviceMap points={telemetryPoints} />
      </div>
```

to:

```tsx
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Localização</h2>
          <button
            type="button"
            onClick={onToggleCollection}
            disabled={toggleCollection.isPending}
            className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              collecting ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {collecting ? 'Parar coleta' : 'Iniciar coleta'}
          </button>
        </div>
        <DeviceMap points={telemetryPoints} />
      </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: PASS (existing command tests + the three new button tests, 13 total).

- [ ] **Step 6: Run the full web suite and build**

Run: `pnpm -C apps/web exec vitest run`
Expected: PASS, output pristine.
Run: `pnpm -C apps/web build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/telemetryCommands.ts apps/web/src/pages/DeviceDetailPage.tsx apps/web/src/pages/DeviceDetailPage.test.tsx
git commit -m "feat(web): add start/stop telemetry collection button"
```

---

## End-to-End Verification (after all tasks)

- [ ] Register a device and start its simulator. Confirm NO telemetry flows and the map stays empty (GPS is command-driven now).
- [ ] Open the device detail page → the button reads "Iniciar coleta"; the map is empty.
- [ ] Click "Iniciar coleta" → a `START_TELEMETRY` command appears in the history going PENDING → ACKED; the marker/trail begins moving live; the button now reads "Parar coleta".
- [ ] Click "Parar coleta" → a `STOP_TELEMETRY` command ACKs; the trail stops growing; the button reads "Iniciar coleta" again.
