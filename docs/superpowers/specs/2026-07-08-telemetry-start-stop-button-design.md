# Telemetry Start/Stop Button — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Builds on:** [GPS Telemetry + Live Map](2026-07-08-gps-telemetry-live-map-design.md) (branch `feat/gps-telemetry-live-map`, not yet merged)

## Goal

Add a button on the device detail page that starts and stops GPS telemetry
collection **at the source** — by commanding the device (simulator) to begin or
stop publishing GPS points. Collection does **not** start automatically: a device
emits GPS only after the user clicks "Iniciar".

## Decisions (from brainstorming)

- **Control layer:** command the device via the existing command pipeline
  (create-command → `devices/{externalId}/commands` → simulator), not a server gate
  or a browser-only pause.
- **Button state:** local intended state in the web app — no server-side
  `telemetryEnabled` field, no new persistence.
- **Default:** collection is **off on connect**. GPS starts only on a
  `START_TELEMETRY` command and stops on `STOP_TELEMETRY`. The button therefore
  starts in the "Iniciar coleta" state.

## Non-Goals

- Server-authoritative collection state (a `telemetryEnabled` column / endpoint).
- Persisting the on/off state across page reloads (reload assumes "not collecting").
- Disabling the button based on device ONLINE/OFFLINE status.
- Any change to the API — the command pipeline already handles arbitrary command
  `type` values and publishes them unchanged.

## Architecture

Reuses the existing command lifecycle end to end; only the simulator's command
handler and the web detail page change. No API or Prisma changes.

```
web button click
  → commandsApi.create({ deviceId, type: START_TELEMETRY | STOP_TELEMETRY })
  → API create-command → MQTT devices/{externalId}/commands
  → simulator handleMessage: decide ACKED/FAILED; if ACKED, start/stop the GPS loop
  → simulator publishes ACKED/FAILED response (command shows in history)
  → (if started) GPS points begin flowing to the live map
```

## Components

### 1. Shared command-type constants (`packages/shared`)

Two exported string constants so the simulator and web agree on the exact type
values (no schema change — command `type` is already a free-form string):

```ts
export const TELEMETRY_START_COMMAND = 'START_TELEMETRY'
export const TELEMETRY_STOP_COMMAND = 'STOP_TELEMETRY'
```

### 2. Simulator (`apps/device-simulator`)

- **Remove auto-start:** `handleConnect()` no longer calls `startGps()`. GPS is off
  when the device connects.
- **Command handling:** in `handleMessage`, keep the existing decide-status +
  respond flow. When the decided status is `ACKED` **and** the command `type` is:
  - `START_TELEMETRY` → `startGps()`
  - `STOP_TELEMETRY` → `stopGps()`

  A command that decides `FAILED` (rng < `failureRate`) does **not** change the GPS
  state and responds `FAILED` — correct execute-then-ack semantics. All other
  command types behave exactly as today (ACK/FAILED, no side effect).
- `SIMULATOR_GPS_ENABLED` keeps its guard role: `startGps()` already returns early
  when `gpsEnabled` is false or `gpsIntervalMs <= 0`, so a `START_TELEMETRY` on a
  hard-disabled simulator is a no-op (still ACKs). Its `.env.example` comment is
  updated to reflect "GPS is command-driven; false hard-disables it" instead of
  "republishes on connect".

### 3. Web (`apps/web`)

`DeviceDetailPage`, in the existing "Localização" section next to the map:

- A single toggle button: label **"Iniciar coleta"** when stopped, **"Parar
  coleta"** when collecting.
- Local state `collecting`, initialized to `false` (matches off-on-connect).
- A dedicated mutation calling
  `commandsApi.create({ deviceId, type: collecting ? TELEMETRY_STOP_COMMAND : TELEMETRY_START_COMMAND })`;
  on success, flip `collecting`. The button is disabled while the mutation is
  pending.
- The command appears in the existing command history list (PENDING → ACKED via the
  existing realtime), and the map starts/stops growing accordingly.

## Testing

- **shared:** the two constants export their exact values.
- **simulator:**
  - On connect, GPS does **not** auto-start (no telemetry published until commanded).
  - A `START_TELEMETRY` command that ACKs starts the GPS loop (telemetry begins);
    `STOP_TELEMETRY` that ACKs stops it (telemetry ceases).
  - A telemetry-control command that decides `FAILED` does **not** change GPS state.
  - Fake timers + injected `rng` for determinism, mirroring the existing simulator
    tests.
- **web:**
  - Button renders "Iniciar coleta" initially.
  - Clicking it sends a `START_TELEMETRY` command and flips the label to "Parar
    coleta"; clicking again sends `STOP_TELEMETRY` and flips back.
  - Button is disabled while the command mutation is pending.

## Rollout / Demo

1. Register a device and start its simulator (GPS now idle by default).
2. Open the device detail page → map is empty, button reads "Iniciar coleta".
3. Click "Iniciar coleta" → command goes PENDING → ACKED; the marker/trail begins
   moving live.
4. Click "Parar coleta" → command ACKs; the trail stops growing.
