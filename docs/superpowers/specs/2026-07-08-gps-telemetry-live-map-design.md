# GPS Telemetry + Live Map — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan

## Goal

Add a new telemetry stream (GPS coordinates) published by each registered device
simulator, ingest and persist it in the API, and render a live map with a moving
marker and trail on the device detail page. Enables the "IoT monitoring platform"
demo narrative beyond command sending.

## Decisions (from brainstorming)

- **Visualization:** map with a moving marker + trail (Leaflet + OpenStreetMap tiles).
- **Movement model:** random walk (each device is an organic, distinct trail).
- **Persistence:** full history in a new `Telemetry` table.
- **Cadence & window:** configurable — simulator publish interval via env var,
  displayed-point limit via API query param, both with sensible defaults.
- **Scope:** device detail page only (fleet map is a non-goal for now).
- **API architecture:** new `telemetry` module mirroring the `commands` module.

## Non-Goals

- Fleet map on the devices list page.
- Speed / altitude / other telemetry dimensions.
- Telemetry feeding device liveness (`lastSeenAt` / ONLINE-OFFLINE stays driven by
  status + heartbeat only).
- Retention / cleanup of old telemetry rows.
- Delivery of telemetry to offline consumers (stream is fire-and-forget; initial
  load comes from the history table).

## Architecture

Same flow shape as the existing command lifecycle:

```
simulator ── MQTT devices/{externalId}/telemetry ──▶ API telemetry.listener
                                                          │
                                            RecordTelemetryUseCase
                                              │                │
                                    PrismaTelemetryRepository   EventEmitter('telemetry.recorded')
                                              │                │
                                          Telemetry table   StatusGateway ── WS 'telemetry:point' ──▶ web
```

Initial trail load on page open: `GET /devices/:id/telemetry?limit=N` → last N points.

## Components

### 1. Shared contract (`packages/shared`)

New topic convention: `devices/{externalId}/telemetry`.

New schema in `src/schemas/mqtt.schema.ts`:

```ts
export const gpsTelemetryMessageSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timestamp: z.string().datetime(),
})
export type GpsTelemetryMessage = z.infer<typeof gpsTelemetryMessageSchema>
```

QoS reuses the shared config value (default 1). **Not retained** — telemetry is a
continuous stream; state on reconnect is not required, and initial load comes from
the REST history endpoint.

### 2. Simulator (`apps/device-simulator`)

New pure module `src/gps.ts`:

- `nextPosition(current: {lat, lon}, stepDeg: number, rng: () => number): {lat, lon}`
  — steps lat and lon by a uniform random delta in `[-stepDeg, +stepDeg]`, clamped
  to valid ranges. Pure and deterministic under an injected `rng`.
- `buildTelemetryMessage(lat, lon, now): GpsTelemetryMessage`.
- `telemetryTopic(externalId): string`.

Starting position = configured base `(startLat, startLon)` plus a small random
offset (within a few hundredths of a degree) computed once at startup, so multiple
devices do not stack on the same pixel.

In `DeviceSimulator`: a second interval (alongside the heartbeat) that, each tick,
computes the next position, updates internal current position, and publishes to the
telemetry topic. Gated by `SIMULATOR_GPS_ENABLED` and `SIMULATOR_GPS_INTERVAL_MS > 0`
(mirrors the heartbeat's idempotent start/stop). Stopped in `stop()` alongside the
heartbeat. Uses the injected `interval`/`clearInterval`/`rng`/`now` deps for testing.

### 3. API telemetry module (`apps/api/src/modules/telemetry`)

Mirrors the `commands` module structure:

- `presentation/mqtt/telemetry.listener.ts` — `@EventPattern('devices/+/telemetry')`,
  extracts `externalId` from the topic (`context.getTopic().split('/')[1]`),
  validates with `gpsTelemetryMessageSchema`, warns + drops invalid payloads,
  delegates to the use case.
- `application/use-cases/record-telemetry.use-case.ts` — resolves the device by
  `externalId`; if missing, logs a warning and drops the point (device must be
  registered first); if found, persists the point and emits `telemetry.recorded`
  with `{ externalId, lat, lon, recordedAt }`.
- `domain/telemetry.repository.ts` — interface + injection token:
  `create(input)` and `listByDevice(deviceId, limit)`, plus device lookup by
  `externalId`.
- `infrastructure/prisma-telemetry.repository.ts` — Prisma implementation.
- `presentation/controllers/telemetry.controller.ts` — `GET /devices/:id/telemetry`.
- `presentation/dtos/list-telemetry-query.dto.ts` — `limit` (default 100, max 500).
- `telemetry.module.ts` — wires listener, use case, repository, controller; imports
  the shared MQTT and realtime modules as needed.

### 4. Persistence (`prisma/schema.prisma`)

```prisma
model Telemetry {
  id         String   @id @default(uuid())
  deviceId   String
  lat        Float
  lon        Float
  recordedAt DateTime            // device-provided timestamp
  createdAt  DateTime @default(now())  // server receive time
  device     Device   @relation(fields: [deviceId], references: [id])

  @@index([deviceId, recordedAt])
}
```

Add `telemetry Telemetry[]` to `Device`. One new migration. `lastSeenAt` is not
touched by telemetry.

### 5. REST endpoint

`GET /devices/:id/telemetry?limit=100`

- `:id` is the internal device UUID (consistent with the device detail route).
- Returns the last `limit` points ordered ascending by `recordedAt`:
  `[{ lat, lon, recordedAt }]`.
- `limit` default 100, capped at 500.

### 6. Realtime (`apps/api/src/shared/realtime`)

`StatusGateway` gains:

```ts
interface TelemetryRecordedEvent { externalId: string; lat: number; lon: number; recordedAt: Date }

@OnEvent('telemetry.recorded')
handleTelemetry(event: TelemetryRecordedEvent) {
  this.server.to(`device:${event.externalId}`).emit('telemetry:point', {
    lat: event.lat, lon: event.lon, recordedAt: event.recordedAt,
  })
}
```

No new subscription — reuses the existing `device:{externalId}` room joined via
`subscribe:device`.

### 7. Frontend (`apps/web`)

- New deps: `leaflet` + `react-leaflet`. Tiles from OpenStreetMap (network — fine in
  the real app). Handle the known Leaflet default-marker-icon bundler issue explicitly.
- `components/DeviceMap.tsx` — props: `points: {lat, lon, recordedAt}[]`. Renders
  `MapContainer` + `TileLayer` + `Polyline` (trail) + `Marker` (current position),
  auto-pans to the latest point. Renders an empty/centered map when there are no points.
- `api/telemetry.ts` + types — `telemetryApi.list(deviceId, limit)`.
- `realtime/useDeviceRealtime.ts` — add an `onTelemetry` handler bound to the
  `telemetry:point` socket event.
- `realtime/merge.ts` — `appendTelemetryPoint(points, newPoint, cap)` appends and
  drops oldest beyond `cap` (bounded memory).
- `pages/DeviceDetailPage.tsx` — loads initial history via React Query
  (`['telemetry', id]`), renders `DeviceMap`, and appends live points capped at the
  same `limit`.

### 8. Configuration

Simulator (`.env.example` + `config.ts`, validated like existing vars):

- `SIMULATOR_GPS_ENABLED` — default `true`.
- `SIMULATOR_GPS_INTERVAL_MS` — default `3000`; `0`/disabled turns GPS off.
- `SIMULATOR_GPS_START_LAT` — default `-23.5505` (São Paulo).
- `SIMULATOR_GPS_START_LON` — default `-46.6333`.
- `SIMULATOR_GPS_STEP_DEG` — default `0.0005`.

API needs no new env var (QoS reused; display limit is a query param).

## Testing

Following existing repo patterns:

- **shared:** `gpsTelemetryMessageSchema` — valid message; rejects out-of-range
  lat/lon and missing/invalid timestamp.
- **simulator:** `gps.ts` `nextPosition` pure/deterministic under injected `rng`
  (including clamping); simulator publishes telemetry on interval and stops the
  interval on `stop()` (fake timers + injected deps); respects `SIMULATOR_GPS_ENABLED`.
- **api:** `RecordTelemetryUseCase` (device found → persist + emit; missing → drop +
  warn); `telemetry.listener` (valid → delegate, invalid → drop); controller returns
  the ordered/limited list; Prisma repository integration test if the existing
  integration-test pattern applies.
- **web:** `DeviceMap` renders polyline + marker for given points and handles the
  empty case; `appendTelemetryPoint` caps length; `useDeviceRealtime` invokes
  `onTelemetry` on `telemetry:point`; `DeviceDetailPage` merges initial history with
  live points.

## Rollout / Demo

1. Register a device (existing flow).
2. Start a simulator for that `externalId` (GPS enabled by default).
3. Open the device detail page → map shows the marker moving and the trail growing
   live; reload → trail restored from history.
