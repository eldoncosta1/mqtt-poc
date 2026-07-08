# device-simulator

Standalone process that simulates an IoT device on the MQTT broker, so the full
command flow (API → broker → device → response → API) can be exercised without hardware.

It connects with `mqtt.js`, subscribes to `devices/{externalId}/commands`, replies on
`devices/{externalId}/responses` (ACKED/FAILED after a delay), and publishes device
status on `devices/{externalId}/status` (retained `online` on connect, `offline` via LWT
on disconnect).

## Run

The simulator reads configuration from the process environment. Unlike the API, it does
**not** auto-load a `.env` file — export the vars in your shell or pass them inline:

```bash
# against local Mosquitto (docker compose up -d mosquitto)
MQTT_URL=mqtt://localhost:1883 DEVICE_EXTERNAL_ID=device-001 \
  pnpm --filter @mqtt-poc/device-simulator start

# override the device id via CLI (takes precedence over DEVICE_EXTERNAL_ID)
pnpm --filter @mqtt-poc/device-simulator start -- --externalId=device-002
```

Run multiple instances (one process per simulated device) pointing at the same broker.

## Configuration (env vars)

| Var | Default | Description |
|---|---|---|
| `MQTT_URL` | — (required) | Broker URL, e.g. `mqtt://localhost:1883` or `mqtts://host:8883` for EMQX Cloud |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | Broker credentials |
| `MQTT_QOS` | `1` | QoS (0/1/2) for subscribe/publish/status/LWT |
| `DEVICE_EXTERNAL_ID` | — (required unless `--externalId`) | Device identifier used in topics |
| `SIMULATOR_RESPONSE_DELAY_MS` | `1000` | Delay before replying to a command |
| `SIMULATOR_FAILURE_RATE` | `0` | Probability (0..1) a response is `FAILED` instead of `ACKED` |
