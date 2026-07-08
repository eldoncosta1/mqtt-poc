# web

Frontend React (Vite) para o sistema de comandos de dispositivos via MQTT: lista/cadastra
dispositivos, envia comandos e acompanha as respostas dos comandos + o status online/offline
dos dispositivos atualizando ao vivo via WebSocket.

## Configuração

`VITE_API_URL` (padrão `http://localhost:3333`) — URL base da API (REST + Socket.IO).
Copie `.env.example` para `.env` para sobrescrever.

> Ao apontar `VITE_API_URL` para uma API não-local, inicie essa API com
> `WEB_ORIGIN=<origem deste app web>` (ex.: `WEB_ORIGIN=http://localhost:5173`),
> caso contrário o CORS do REST e do gateway Socket.IO vão rejeitar o navegador.

## Executar (stack local completa)

```bash
# 1. infraestrutura
docker compose up -d
pnpm prisma migrate deploy

# 2. API (:3333)
pnpm --filter @mqtt-poc/api start

# 3. um dispositivo simulado (para os comandos serem respondidos)
pnpm dev:simulator            # sobe "device-001"; use --externalId=... para outro id

# 4. servidor de desenvolvimento do web (:5173)
pnpm dev:web
```

Depois abra http://localhost:5173, cadastre um dispositivo cujo External ID corresponda ao
`DEVICE_EXTERNAL_ID` do simulador, abra-o e envie um comando — ele passa de `PENDING` para
`ACKED` ao vivo, e o selo do dispositivo reflete o status online/offline em tempo real.

## Visualizando as mensagens no broker

```bash
docker compose exec mosquitto mosquitto_sub -t 'devices/#' -v
```

## Testes

```bash
pnpm --filter @mqtt-poc/web test
```
