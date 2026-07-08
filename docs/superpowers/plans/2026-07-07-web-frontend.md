# Web Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web` — a React (Vite) frontend to list/register devices, send commands, and watch command responses + device online/offline status update live over WebSocket.

**Architecture:** React 18 + Vite, TanStack Query for server state (REST against the already-built API), `socket.io-client` for realtime updates that are merged into the query cache, react-router with two routes (device list `/`, device detail `/devices/:id`), plain Tailwind for styling (no shared UI package). No authentication (out of scope this phase). Realtime cache-merge logic is factored into pure functions with unit tests; the socket hook is tested with a mocked `socket.io-client`; pages are tested with mocked API modules.

**Tech Stack:** React 18.3, Vite 5.4, `@tanstack/react-query` 5.59, `axios` 1.7, `react-router-dom` 6.26, `socket.io-client` 4.8 (matches server `socket.io` 4.8), Tailwind 3.4, Vitest + @testing-library/react + jsdom. TypeScript 5.6.

This plan corresponds to the web-frontend scope of `docs/superpowers/specs/2026-07-05-mqtt-device-commands-design.md` (architecture overview + "Tempo real (WebSocket)" section). The API (`apps/api`) and device simulator (`apps/device-simulator`) it interoperates with are already built and merged.

## Global Constraints

- Node >= 22, pnpm >= 9.15.0 (pinned in root `package.json`); dev environment actually runs Node v20.18.0, so pnpm prints an engine WARN that is expected and must not be "fixed".
- TypeScript 5.6, `strict: true`.
- No authentication anywhere (out of scope).
- REST base URL from `import.meta.env.VITE_API_URL ?? 'http://localhost:3333'` (the API listens on 3333). The Socket.IO server is the same origin.
- The API surface consumed (exact, already built):
  - `GET /devices` → `Device[]`; `GET /devices/:id` → `Device`; `POST /devices` body `{ externalId, name }` → `Device`.
  - `GET /commands` → `Command[]` (all commands; filter by `deviceId` client-side); `GET /commands/:id` → `Command`; `POST /commands` body `{ deviceId, type, payload? }` → `Command`.
  - `Device` = `{ id, externalId, name, status: 'ONLINE'|'OFFLINE'|'UNKNOWN', lastSeenAt: string|null, createdAt, updatedAt }`.
  - `Command` = `{ id, deviceId, type, payload: unknown, status: 'PENDING'|'ACKED'|'FAILED'|'PUBLISH_FAILED'|'TIMEOUT', response: unknown, createdAt, respondedAt: string|null }`.
- WebSocket protocol (Socket.IO, default namespace, no auth): on the detail screen the client emits `subscribe:device` with the device's `externalId`; the server pushes `command:updated` `{ commandId, status, response, respondedAt }` and `device:status` `{ externalId, status, lastSeenAt }` to that device's room.
- The API's CORS + gateway CORS default to `WEB_ORIGIN ?? 'http://localhost:5173'`; Vite's dev server default port is 5173 — do not change it.
- Web tests are named `*.test.ts`/`*.test.tsx` and run via `pnpm --filter @mqtt-poc/web test` (jsdom env, react plugin). They intentionally do NOT match the root `vitest.config.ts` glob (`apps/**/src/**/*.spec.ts`, node env), so `pnpm test` at the root will not pick them up — this mirrors the reference monorepo's split.

---

### Task 1: Scaffold & App Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/tailwind.config.js`
- Create: `apps/web/index.html`
- Create: `apps/web/.env.example`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/test-setup.ts`
- Create: `apps/web/src/pages/DevicesPage.tsx` (placeholder, replaced in Task 4)
- Create: `apps/web/src/pages/DeviceDetailPage.tsx` (placeholder, replaced in Task 5)

**Interfaces:**
- Consumes: nothing (leaf app).
- Produces: a running Vite app named `@mqtt-poc/web` with a `QueryClientProvider` + `RouterProvider`, two routes (`/` → `DevicesPage`, `/devices/:id` → `DeviceDetailPage`), a `test` script (`vitest run`), and Tailwind wired.

- [ ] **Step 1: Create build/config files**

`apps/web/package.json`:
```json
{
  "name": "@mqtt-poc/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "axios": "^1.7.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "socket.io-client": "^4.8.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.2",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.0",
    "vite": "^5.4.10",
    "vitest": "^2.1.8"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`apps/web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`apps/web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
```

`apps/web/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
  },
})
```

`apps/web/postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

`apps/web/tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MQTT Device Commands</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/.env.example`:
```
VITE_API_URL=http://localhost:3333
```

- [ ] **Step 2: Create source shell files**

`apps/web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/web/src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
```

`apps/web/src/test-setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

`apps/web/src/pages/DevicesPage.tsx` (placeholder, replaced in Task 4):
```tsx
export function DevicesPage() {
  return <div>Dispositivos</div>
}
```

`apps/web/src/pages/DeviceDetailPage.tsx` (placeholder, replaced in Task 5):
```tsx
export function DeviceDetailPage() {
  return <div>Detalhe do dispositivo</div>
}
```

`apps/web/src/router.tsx`:
```tsx
import { createBrowserRouter } from 'react-router-dom'
import { DevicesPage } from './pages/DevicesPage'
import { DeviceDetailPage } from './pages/DeviceDetailPage'

export const router = createBrowserRouter([
  { path: '/', element: <DevicesPage /> },
  { path: '/devices/:id', element: <DeviceDetailPage /> },
])
```

`apps/web/src/App.tsx`:
```tsx
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: false },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: completes; `@mqtt-poc/web` linked into the workspace (root `postinstall` rebuilds `@mqtt-poc/shared`, expected). Node-version WARN expected.

- [ ] **Step 4: Verify the app type-checks and builds**

Run: `pnpm --filter @mqtt-poc/web build`
Expected: `tsc` then `vite build` complete with no errors; `apps/web/dist/index.html` produced.

- [ ] **Step 5: Verify the dev server serves the shell**

Run:
```bash
pnpm --filter @mqtt-poc/web dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
kill %1
```
Expected: prints `200`.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold React app shell with router, query client, tailwind"
```

---

### Task 2: API Types & Client Layer

**Files:**
- Create: `apps/web/src/api/types.ts`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/devices.ts`
- Create: `apps/web/src/api/commands.ts`
- Test: `apps/web/src/api/api.test.ts`

**Interfaces:**
- Consumes: the REST surface from Global Constraints.
- Produces:
  - Types `DeviceStatus`, `CommandStatus`, `Device`, `Command` (shapes from Global Constraints).
  - `API_URL: string` and a configured `api` axios instance (from `client.ts`).
  - `devicesApi = { list(): Promise<Device[]>; get(id): Promise<Device>; create({externalId,name}): Promise<Device> }`.
  - `commandsApi = { list(): Promise<Command[]>; get(id): Promise<Command>; create({deviceId,type,payload?}): Promise<Command> }`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/api/api.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './client'
import { devicesApi } from './devices'
import { commandsApi } from './commands'

describe('devicesApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /devices and returns the data array', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'd1' }] })
    const result = await devicesApi.list()
    expect(api.get).toHaveBeenCalledWith('/devices')
    expect(result).toEqual([{ id: 'd1' }])
  })

  it('get(id) GETs /devices/:id', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { id: 'd1' } })
    const result = await devicesApi.get('d1')
    expect(api.get).toHaveBeenCalledWith('/devices/d1')
    expect(result).toEqual({ id: 'd1' })
  })

  it('create() POSTs /devices with the body and returns the created device', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'd2' } })
    const result = await devicesApi.create({ externalId: 'device-2', name: 'Sensor 2' })
    expect(api.post).toHaveBeenCalledWith('/devices', { externalId: 'device-2', name: 'Sensor 2' })
    expect(result).toEqual({ id: 'd2' })
  })
})

describe('commandsApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /commands', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'c1' }] })
    const result = await commandsApi.list()
    expect(api.get).toHaveBeenCalledWith('/commands')
    expect(result).toEqual([{ id: 'c1' }])
  })

  it('get(id) GETs /commands/:id', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { id: 'c1' } })
    const result = await commandsApi.get('c1')
    expect(api.get).toHaveBeenCalledWith('/commands/c1')
    expect(result).toEqual({ id: 'c1' })
  })

  it('create() POSTs /commands with the body', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'c2' } })
    const result = await commandsApi.create({ deviceId: 'd1', type: 'REBOOT' })
    expect(api.post).toHaveBeenCalledWith('/commands', { deviceId: 'd1', type: 'REBOOT' })
    expect(result).toEqual({ id: 'c2' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/api/api.test.ts`
Expected: FAIL, modules `./client`/`./devices`/`./commands` not found.

- [ ] **Step 3: Implement types and client**

`apps/web/src/api/types.ts`:
```typescript
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
export type CommandStatus = 'PENDING' | 'ACKED' | 'FAILED' | 'PUBLISH_FAILED' | 'TIMEOUT'

export interface Device {
  id: string
  externalId: string
  name: string
  status: DeviceStatus
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Command {
  id: string
  deviceId: string
  type: string
  payload: unknown
  status: CommandStatus
  response: unknown
  createdAt: string
  respondedAt: string | null
}
```

`apps/web/src/api/client.ts`:
```typescript
import axios from 'axios'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333'

export const api = axios.create({ baseURL: API_URL })
```

`apps/web/src/api/devices.ts`:
```typescript
import { api } from './client'
import type { Device } from './types'

export const devicesApi = {
  list: () => api.get<Device[]>('/devices').then((r) => r.data),
  get: (id: string) => api.get<Device>(`/devices/${id}`).then((r) => r.data),
  create: (dto: { externalId: string; name: string }) => api.post<Device>('/devices', dto).then((r) => r.data),
}
```

`apps/web/src/api/commands.ts`:
```typescript
import { api } from './client'
import type { Command } from './types'

export const commandsApi = {
  list: () => api.get<Command[]>('/commands').then((r) => r.data),
  get: (id: string) => api.get<Command>(`/commands/${id}`).then((r) => r.data),
  create: (dto: { deviceId: string; type: string; payload?: Record<string, unknown> }) =>
    api.post<Command>('/commands', dto).then((r) => r.data),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/api/api.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): add API types and typed client for devices/commands"
```

---

### Task 3: Realtime — Cache-Merge Functions & Socket Hook

**Files:**
- Create: `apps/web/src/realtime/merge.ts`
- Test: `apps/web/src/realtime/merge.test.ts`
- Create: `apps/web/src/realtime/useDeviceRealtime.ts`
- Test: `apps/web/src/realtime/useDeviceRealtime.test.tsx`

**Interfaces:**
- Consumes: `Device`, `Command`, `DeviceStatus`, `CommandStatus` (Task 2); `API_URL` (Task 2); `socket.io-client`'s `io`.
- Produces:
  - `interface CommandUpdate { commandId: string; status: CommandStatus; response: unknown; respondedAt: string | null }`
  - `interface DeviceStatusUpdate { externalId: string; status: DeviceStatus; lastSeenAt: string | null }`
  - `applyCommandUpdate(commands: Command[], update: CommandUpdate): Command[]` — returns a new array with the matching command's status/response/respondedAt replaced; unmatched commands untouched.
  - `applyDeviceStatus(device: Device, update: DeviceStatusUpdate): Device` — returns a new device with status/lastSeenAt replaced.
  - `interface DeviceRealtimeHandlers { onCommandUpdated?: (u: CommandUpdate) => void; onDeviceStatus?: (u: DeviceStatusUpdate) => void }`
  - `useDeviceRealtime(externalId: string | undefined, handlers: DeviceRealtimeHandlers): void` — a React hook that, when `externalId` is defined, opens a socket to `API_URL`, emits `subscribe:device` on connect, forwards `command:updated`/`device:status` to the (ref-stored) handlers, and disconnects on cleanup.

- [ ] **Step 1: Write the failing test for the merge functions**

`apps/web/src/realtime/merge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { applyCommandUpdate, applyDeviceStatus } from './merge'
import type { Command, Device } from '../api/types'

const command: Command = {
  id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null,
  status: 'PENDING', response: null, createdAt: '2026-07-07T10:00:00.000Z', respondedAt: null,
}
const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'UNKNOWN', lastSeenAt: null, createdAt: '2026-07-07T10:00:00.000Z', updatedAt: '2026-07-07T10:00:00.000Z',
}

describe('applyCommandUpdate', () => {
  it('replaces status/response/respondedAt on the matching command', () => {
    const result = applyCommandUpdate([command], {
      commandId: 'c1', status: 'ACKED', response: { ok: true }, respondedAt: '2026-07-07T10:00:01.000Z',
    })
    expect(result[0]).toMatchObject({ id: 'c1', status: 'ACKED', response: { ok: true }, respondedAt: '2026-07-07T10:00:01.000Z' })
  })

  it('leaves non-matching commands untouched and does not mutate the input', () => {
    const input = [command]
    const result = applyCommandUpdate(input, { commandId: 'other', status: 'ACKED', response: null, respondedAt: null })
    expect(result[0]).toEqual(command)
    expect(result).not.toBe(input)
    expect(input[0].status).toBe('PENDING')
  })
})

describe('applyDeviceStatus', () => {
  it('replaces status/lastSeenAt and does not mutate the input', () => {
    const result = applyDeviceStatus(device, { externalId: 'device-1', status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result).toMatchObject({ status: 'ONLINE', lastSeenAt: '2026-07-07T10:05:00.000Z' })
    expect(result).not.toBe(device)
    expect(device.status).toBe('UNKNOWN')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/realtime/merge.test.ts`
Expected: FAIL, module `./merge` not found.

- [ ] **Step 3: Implement the merge functions**

`apps/web/src/realtime/merge.ts`:
```typescript
import type { Command, CommandStatus, Device, DeviceStatus } from '../api/types'

export interface CommandUpdate {
  commandId: string
  status: CommandStatus
  response: unknown
  respondedAt: string | null
}

export interface DeviceStatusUpdate {
  externalId: string
  status: DeviceStatus
  lastSeenAt: string | null
}

export function applyCommandUpdate(commands: Command[], update: CommandUpdate): Command[] {
  return commands.map((c) =>
    c.id === update.commandId
      ? { ...c, status: update.status, response: update.response, respondedAt: update.respondedAt }
      : c,
  )
}

export function applyDeviceStatus(device: Device, update: DeviceStatusUpdate): Device {
  return { ...device, status: update.status, lastSeenAt: update.lastSeenAt }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/realtime/merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the socket hook**

`apps/web/src/realtime/useDeviceRealtime.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useDeviceRealtime, type DeviceRealtimeHandlers } from './useDeviceRealtime'

const socketHandlers: Record<string, (...args: any[]) => void> = {}
const fakeSocket = {
  on: vi.fn((event: string, cb: (...args: any[]) => void) => {
    socketHandlers[event] = cb
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
}
const ioMock = vi.fn(() => fakeSocket)

vi.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }))

function Harness({ externalId, handlers }: { externalId?: string; handlers: DeviceRealtimeHandlers }) {
  useDeviceRealtime(externalId, handlers)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(socketHandlers)) delete socketHandlers[k]
})

describe('useDeviceRealtime', () => {
  it('does not open a socket when externalId is undefined', () => {
    render(<Harness handlers={{}} />)
    expect(ioMock).not.toHaveBeenCalled()
  })

  it('subscribes to the device room on connect', () => {
    render(<Harness externalId="device-1" handlers={{}} />)
    expect(ioMock).toHaveBeenCalledTimes(1)
    socketHandlers['connect']()
    expect(fakeSocket.emit).toHaveBeenCalledWith('subscribe:device', 'device-1')
  })

  it('forwards command:updated and device:status to the handlers', () => {
    const onCommandUpdated = vi.fn()
    const onDeviceStatus = vi.fn()
    render(<Harness externalId="device-1" handlers={{ onCommandUpdated, onDeviceStatus }} />)
    socketHandlers['command:updated']({ commandId: 'c1', status: 'ACKED', response: null, respondedAt: null })
    socketHandlers['device:status']({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
    expect(onCommandUpdated).toHaveBeenCalledWith({ commandId: 'c1', status: 'ACKED', response: null, respondedAt: null })
    expect(onDeviceStatus).toHaveBeenCalledWith({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
  })

  it('disconnects the socket on unmount', () => {
    const { unmount } = render(<Harness externalId="device-1" handlers={{}} />)
    unmount()
    expect(fakeSocket.disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/realtime/useDeviceRealtime.test.tsx`
Expected: FAIL, module `./useDeviceRealtime` not found.

- [ ] **Step 7: Implement the socket hook**

`apps/web/src/realtime/useDeviceRealtime.ts`:
```typescript
import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '../api/client'
import type { CommandUpdate, DeviceStatusUpdate } from './merge'

export interface DeviceRealtimeHandlers {
  onCommandUpdated?: (update: CommandUpdate) => void
  onDeviceStatus?: (update: DeviceStatusUpdate) => void
}

export function useDeviceRealtime(externalId: string | undefined, handlers: DeviceRealtimeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!externalId) return

    const socket = io(API_URL, { transports: ['websocket'] })
    socket.on('connect', () => socket.emit('subscribe:device', externalId))
    socket.on('command:updated', (update: CommandUpdate) => handlersRef.current.onCommandUpdated?.(update))
    socket.on('device:status', (update: DeviceStatusUpdate) => handlersRef.current.onDeviceStatus?.(update))

    return () => {
      socket.disconnect()
    }
  }, [externalId])
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/realtime/useDeviceRealtime.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/realtime
git commit -m "feat(web): add realtime cache-merge helpers and device socket hook"
```

---

### Task 4: Devices List Page

**Files:**
- Create: `apps/web/src/components/StatusBadge.tsx`
- Modify: `apps/web/src/pages/DevicesPage.tsx` (replace the Task 1 placeholder)
- Test: `apps/web/src/pages/DevicesPage.test.tsx`

**Interfaces:**
- Consumes: `devicesApi` (Task 2); `Device`/`DeviceStatus`/`CommandStatus` (Task 2); react-router `Link`; TanStack Query.
- Produces:
  - `StatusBadge({ status }: { status: DeviceStatus | CommandStatus }): JSX.Element` — a small colored label rendering the status text.
  - `DevicesPage()` — lists devices (query key `['devices']`), each linking to `/devices/:id`; a register form (`externalId`, `name`) that POSTs and invalidates `['devices']`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/DevicesPage.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DevicesPage } from './DevicesPage'
import { devicesApi } from '../api/devices'
import type { Device } from '../api/types'

vi.mock('../api/devices')

const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'ONLINE', lastSeenAt: null, createdAt: '', updatedAt: '',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('DevicesPage', () => {
  it('renders the list of devices from the API', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([device])
    renderPage()
    expect(await screen.findByText('Sensor 1')).toBeInTheDocument()
    expect(screen.getByText('device-1')).toBeInTheDocument()
  })

  it('shows an empty state when there are no devices', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/nenhum dispositivo/i)).toBeInTheDocument()
  })

  it('registers a new device and refreshes the list', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([])
    vi.mocked(devicesApi.create).mockResolvedValue({ ...device, id: 'd2', externalId: 'device-2', name: 'Sensor 2', status: 'UNKNOWN' })
    renderPage()
    await screen.findByText(/nenhum dispositivo/i)
    await userEvent.type(screen.getByLabelText('External ID'), 'device-2')
    await userEvent.type(screen.getByLabelText('Nome'), 'Sensor 2')
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }))
    await waitFor(() => expect(devicesApi.create).toHaveBeenCalledWith({ externalId: 'device-2', name: 'Sensor 2' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/pages/DevicesPage.test.tsx`
Expected: FAIL (the placeholder page renders only "Dispositivos"; queries/form not present).

- [ ] **Step 3: Implement StatusBadge**

`apps/web/src/components/StatusBadge.tsx`:
```tsx
import type { CommandStatus, DeviceStatus } from '../api/types'

const COLORS: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-800',
  OFFLINE: 'bg-gray-200 text-gray-700',
  UNKNOWN: 'bg-yellow-100 text-yellow-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  ACKED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  PUBLISH_FAILED: 'bg-red-100 text-red-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
}

export function StatusBadge({ status }: { status: DeviceStatus | CommandStatus }) {
  const color = COLORS[status] ?? 'bg-gray-100 text-gray-700'
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>
}
```

- [ ] **Step 4: Implement DevicesPage**

`apps/web/src/pages/DevicesPage.tsx` (replace the placeholder entirely):
```tsx
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../api/devices'
import { StatusBadge } from '../components/StatusBadge'

export function DevicesPage() {
  const queryClient = useQueryClient()
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: devicesApi.list })
  const [externalId, setExternalId] = useState('')
  const [name, setName] = useState('')

  const createDevice = useMutation({
    mutationFn: devicesApi.create,
    onSuccess: () => {
      setExternalId('')
      setName('')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!externalId.trim() || !name.trim()) return
    createDevice.mutate({ externalId: externalId.trim(), name: name.trim() })
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Dispositivos</h1>

      <form onSubmit={onSubmit} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col">
          <label htmlFor="externalId" className="mb-1 text-sm font-medium text-gray-700">External ID</label>
          <input id="externalId" value={externalId} onChange={(e) => setExternalId(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="device-001" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="name" className="mb-1 text-sm font-medium text-gray-700">Nome</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Sensor da sala" />
        </div>
        <button type="submit" disabled={createDevice.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          Cadastrar
        </button>
      </form>

      {devicesQuery.isLoading && <p className="text-gray-500">Carregando...</p>}
      {devicesQuery.isError && <p className="text-red-600">Erro ao carregar dispositivos.</p>}

      {devicesQuery.data && devicesQuery.data.length === 0 && (
        <p className="text-gray-500">Nenhum dispositivo cadastrado ainda.</p>
      )}

      {devicesQuery.data && devicesQuery.data.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {devicesQuery.data.map((device) => (
            <li key={device.id} className="flex items-center justify-between px-4 py-3">
              <Link to={`/devices/${device.id}`} className="flex flex-col">
                <span className="font-medium text-blue-700 hover:underline">{device.name}</span>
                <span className="text-xs text-gray-500">{device.externalId}</span>
              </Link>
              <StatusBadge status={device.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/pages/DevicesPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/StatusBadge.tsx apps/web/src/pages/DevicesPage.tsx apps/web/src/pages/DevicesPage.test.tsx
git commit -m "feat(web): implement devices list page with register form"
```

---

### Task 5: Device Detail Page (with realtime)

**Files:**
- Modify: `apps/web/src/pages/DeviceDetailPage.tsx` (replace the Task 1 placeholder)
- Test: `apps/web/src/pages/DeviceDetailPage.test.tsx`

**Interfaces:**
- Consumes: `devicesApi`/`commandsApi` (Task 2); `applyCommandUpdate`/`applyDeviceStatus`/`useDeviceRealtime` (Task 3); `StatusBadge` (Task 4); react-router `useParams`/`Link`; TanStack Query.
- Produces: `DeviceDetailPage()` — shows the device (query key `['device', id]`) with its live status, a send-command form (`type` + optional JSON `payload`) that POSTs and invalidates `['commands']`, and a list of that device's commands (from query key `['commands']`, filtered by `deviceId`). Realtime `command:updated` merges into the `['commands']` cache via `applyCommandUpdate`; `device:status` merges into the `['device', id]` cache via `applyDeviceStatus`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/DeviceDetailPage.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DeviceDetailPage } from './DeviceDetailPage'
import { devicesApi } from '../api/devices'
import { commandsApi } from '../api/commands'
import type { Command, Device } from '../api/types'

vi.mock('../api/devices')
vi.mock('../api/commands')
vi.mock('../realtime/useDeviceRealtime', () => ({ useDeviceRealtime: vi.fn() }))

const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'ONLINE', lastSeenAt: null, createdAt: '', updatedAt: '',
}
const command: Command = {
  id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null,
  status: 'PENDING', response: null, createdAt: '', respondedAt: null,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/devices/d1']}>
        <Routes>
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('DeviceDetailPage', () => {
  it('renders the device name, status, and its commands', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([command, { ...command, id: 'other', deviceId: 'd2' }])
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Sensor 1' })).toBeInTheDocument()
    expect(await screen.findByText('REBOOT')).toBeInTheDocument()
    // only this device's command is shown (deviceId d1), not the d2 one
    expect(screen.getAllByText('REBOOT')).toHaveLength(1)
  })

  it('sends a command with the entered type', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(commandsApi.create).mockResolvedValue({ ...command, id: 'c2', type: 'SET_CONFIG' })
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.type(screen.getByLabelText('Tipo do comando'), 'SET_CONFIG')
    await userEvent.click(screen.getByRole('button', { name: /enviar comando/i }))
    await waitFor(() => expect(commandsApi.create).toHaveBeenCalledWith({ deviceId: 'd1', type: 'SET_CONFIG' }))
  })

  it('shows an error and does not submit when the payload is invalid JSON', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.type(screen.getByLabelText('Tipo do comando'), 'REBOOT')
    await userEvent.type(screen.getByLabelText(/payload/i), '{not json')
    await userEvent.click(screen.getByRole('button', { name: /enviar comando/i }))
    expect(await screen.findByText(/payload inválido/i)).toBeInTheDocument()
    expect(commandsApi.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: FAIL (placeholder renders only "Detalhe do dispositivo").

- [ ] **Step 3: Implement DeviceDetailPage**

`apps/web/src/pages/DeviceDetailPage.tsx` (replace the placeholder entirely):
```tsx
import { FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../api/devices'
import { commandsApi } from '../api/commands'
import type { Command, Device } from '../api/types'
import { StatusBadge } from '../components/StatusBadge'
import { useDeviceRealtime } from '../realtime/useDeviceRealtime'
import { applyCommandUpdate, applyDeviceStatus } from '../realtime/merge'

export function DeviceDetailPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()

  const deviceQuery = useQuery({ queryKey: ['device', id], queryFn: () => devicesApi.get(id), enabled: !!id })
  const commandsQuery = useQuery({ queryKey: ['commands'], queryFn: commandsApi.list })

  const device = deviceQuery.data
  const deviceCommands = (commandsQuery.data ?? []).filter((c) => c.deviceId === id)

  useDeviceRealtime(device?.externalId, {
    onCommandUpdated: (update) => {
      queryClient.setQueryData<Command[]>(['commands'], (old) => (old ? applyCommandUpdate(old, update) : old))
    },
    onDeviceStatus: (update) => {
      queryClient.setQueryData<Device>(['device', id], (old) => (old ? applyDeviceStatus(old, update) : old))
    },
  })

  const [type, setType] = useState('')
  const [payloadText, setPayloadText] = useState('')
  const [payloadError, setPayloadError] = useState<string | null>(null)

  const createCommand = useMutation({
    mutationFn: commandsApi.create,
    onSuccess: () => {
      setType('')
      setPayloadText('')
      queryClient.invalidateQueries({ queryKey: ['commands'] })
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setPayloadError(null)
    if (!type.trim()) return

    let payload: Record<string, unknown> | undefined
    if (payloadText.trim()) {
      try {
        payload = JSON.parse(payloadText)
      } catch {
        setPayloadError('Payload inválido: precisa ser um JSON válido.')
        return
      }
    }
    createCommand.mutate({ deviceId: id, type: type.trim(), ...(payload ? { payload } : {}) })
  }

  if (deviceQuery.isLoading) return <div className="p-6 text-gray-500">Carregando...</div>
  if (deviceQuery.isError || !device) return <div className="p-6 text-red-600">Dispositivo não encontrado.</div>

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/" className="mb-4 inline-block text-sm text-blue-700 hover:underline">&larr; Dispositivos</Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{device.name}</h1>
          <p className="text-sm text-gray-500">{device.externalId}</p>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <form onSubmit={onSubmit} className="mb-8 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col">
          <label htmlFor="type" className="mb-1 text-sm font-medium text-gray-700">Tipo do comando</label>
          <input id="type" value={type} onChange={(e) => setType(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="REBOOT" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="payload" className="mb-1 text-sm font-medium text-gray-700">Payload (JSON, opcional)</label>
          <textarea id="payload" value={payloadText} onChange={(e) => setPayloadText(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 font-mono text-sm" rows={3} placeholder='{"delaySeconds": 5}' />
          {payloadError && <span className="mt-1 text-xs text-red-600">{payloadError}</span>}
        </div>
        <button type="submit" disabled={createCommand.isPending}
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          Enviar comando
        </button>
      </form>

      <h2 className="mb-3 text-lg font-semibold text-gray-900">Comandos</h2>
      {commandsQuery.isLoading && <p className="text-gray-500">Carregando...</p>}
      {deviceCommands.length === 0 && !commandsQuery.isLoading && (
        <p className="text-gray-500">Nenhum comando enviado para este dispositivo.</p>
      )}
      {deviceCommands.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {deviceCommands.map((command) => (
            <li key={command.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="font-medium text-gray-900">{command.type}</span>
                <span className="text-xs text-gray-500">{command.id}</span>
              </div>
              <StatusBadge status={command.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mqtt-poc/web exec vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole web test suite to confirm no regressions**

Run: `pnpm --filter @mqtt-poc/web test`
Expected: PASS (all web tests: api, merge, useDeviceRealtime, DevicesPage, DeviceDetailPage).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/DeviceDetailPage.tsx apps/web/src/pages/DeviceDetailPage.test.tsx
git commit -m "feat(web): implement device detail page with command form and realtime updates"
```

---

### Task 6: Full-Stack Manual Verification & README

**Files:**
- Create: `apps/web/README.md`

**Interfaces:**
- Consumes: the full running system (API + Mosquitto + Postgres + simulator + web dev server).
- Produces: a README documenting how to run the whole stack; no code changes.

- [ ] **Step 1: Bring up the full stack**

Run:
```bash
docker compose up -d
until docker compose exec -T postgres pg_isready -U mqtt -d mqtt_poc; do sleep 1; done
pnpm prisma migrate deploy
```
Expected: Postgres + Mosquitto running, migrations applied.

- [ ] **Step 2: Start API, simulator, and web dev server**

Run (each in the background):
```bash
# API on :3333
( cp -n .env.example .env 2>/dev/null; pnpm --filter @mqtt-poc/api build && node apps/api/dist/main.js ) &
sleep 3
# Web dev server on :5173
pnpm --filter @mqtt-poc/web dev &
sleep 3
```
Expected: API logs "Nest application successfully started"; Vite prints the local URL on :5173.

- [ ] **Step 3: Register a device and start a simulator for it**

Run:
```bash
DEVICE_JSON=$(curl -s -X POST http://localhost:3333/devices -H "Content-Type: application/json" -d '{"externalId":"device-web-001","name":"Sensor Web"}')
echo "$DEVICE_JSON"
MQTT_URL=mqtt://localhost:1883 DEVICE_EXTERNAL_ID=device-web-001 SIMULATOR_RESPONSE_DELAY_MS=1000 \
  pnpm --filter @mqtt-poc/device-simulator start &
sleep 2
```
Expected: the device is created; the simulator logs `conectado como device-web-001` and publishes online status.

- [ ] **Step 4: Verify the end-to-end UI flow manually**

Open `http://localhost:5173/` in a browser and confirm:
1. "Sensor Web" appears in the device list. Its badge shows `ONLINE` (the simulator published online status).
2. Click into the device. Send a command with type `REBOOT`.
3. The command appears with status `PENDING`, then flips to `ACKED` within ~1s **without reloading the page** (via the `command:updated` WebSocket event).
4. Stop the simulator process (Ctrl-C / `kill`); within a moment the device badge flips to `OFFLINE` (via the LWT `device:status` event).

Record the observed result (this is a manual check; note pass/fail for each of the 4 points).

- [ ] **Step 5: Tear down background processes**

Run:
```bash
kill %1 %2 %3 2>/dev/null || true
lsof -ti:3333 -ti:5173 2>/dev/null | xargs -r kill -9 || true
```
Expected: processes stopped.

- [ ] **Step 6: Write the README**

`apps/web/README.md`:
```markdown
# web

React (Vite) frontend for the MQTT device-commands system: list/register devices,
send commands, and watch command responses + device online/offline status update
live over WebSocket.

## Configuration

`VITE_API_URL` (default `http://localhost:3333`) — base URL of the API (REST + Socket.IO).
Copy `.env.example` to `.env` to override.

## Run (full local stack)

```bash
# 1. infra
docker compose up -d
pnpm prisma migrate deploy

# 2. API (:3333)
pnpm --filter @mqtt-poc/api start

# 3. a simulated device (so commands get answered)
MQTT_URL=mqtt://localhost:1883 DEVICE_EXTERNAL_ID=device-001 \
  pnpm --filter @mqtt-poc/device-simulator start

# 4. web dev server (:5173)
pnpm --filter @mqtt-poc/web dev
```

Then open http://localhost:5173, register a device whose External ID matches the
simulator's `DEVICE_EXTERNAL_ID`, open it, and send a command — it flips from
`PENDING` to `ACKED` live, and the device badge reflects online/offline in real time.

## Test

```bash
pnpm --filter @mqtt-poc/web test
```
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/README.md
git commit -m "docs(web): add README with full-stack run recipe"
```

---

## Self-Review Notes

- **Spec coverage:** React (Vite) frontend ✓ (Task 1); list devices ✓ (Task 4); register device ✓ (Task 4); send commands ✓ (Task 5); realtime command status + device online/offline via WebSocket ✓ (Tasks 3, 5 — `subscribe:device` on the detail screen, `command:updated`/`device:status` merged into the query cache); no auth ✓ (nothing auth-related anywhere); interoperates with the exact REST + Socket.IO surface the API exposes ✓ (Global Constraints).
- **Placeholder scan:** no TBD/TODO; every code step contains complete code; the Task 1 page placeholders are explicitly replaced in Tasks 4/5.
- **Type consistency:** `Device`/`Command`/`DeviceStatus`/`CommandStatus` defined in Task 2 are used unchanged in Tasks 3/4/5. `CommandUpdate`/`DeviceStatusUpdate` defined in Task 3 (`merge.ts`) are imported by `useDeviceRealtime.ts` (Task 3) and the detail page (Task 5). `applyCommandUpdate`/`applyDeviceStatus`/`useDeviceRealtime`/`StatusBadge` signatures match between definition and use. The Socket.IO event names/payloads (`subscribe:device`, `command:updated {commandId,status,response,respondedAt}`, `device:status {externalId,status,lastSeenAt}`) match the API's `StatusGateway` exactly.
- **Testing note:** web tests use `*.test.ts(x)` + a jsdom vitest config and run via `pnpm --filter @mqtt-poc/web test`; they do not match the root node-env `*.spec.ts` glob, so the root `pnpm test` is unaffected. This mirrors the reference monorepo. The realtime WebSocket path is covered by unit tests (mocked `socket.io-client` + pure merge functions) and confirmed end-to-end by the manual verification in Task 6, consistent with the spec's note that the frontend's full-stack behavior is manually verified.
- **Scope check:** two screens + register/send forms + realtime, no more — matches the confirmed scope (device list + device detail, plain Tailwind, no auth, no third "all commands" screen).
