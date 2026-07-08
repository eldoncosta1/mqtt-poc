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
