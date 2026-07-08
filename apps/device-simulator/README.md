# device-simulator

Processo standalone que simula um dispositivo IoT no broker MQTT, permitindo exercitar
o fluxo completo de comandos (API → broker → dispositivo → resposta → API) sem hardware.

Ele se conecta com `mqtt.js`, assina `devices/{externalId}/commands`, responde em
`devices/{externalId}/responses` (ACKED/FAILED após um atraso) e publica o status do
dispositivo em `devices/{externalId}/status` (`online` retido ao conectar, `offline` via
LWT ao desconectar).

## Dev (hot-reload)

Para desenvolvimento, use o script `dev:simulator` na raiz — ele roda o TypeScript direto
com `tsx watch` (recarrega ao salvar) e já assume os defaults locais
`MQTT_URL=mqtt://localhost:1883` e `DEVICE_EXTERNAL_ID=device-001`, então funciona sem
argumentos (só precisa do Mosquitto de pé: `docker compose up -d mosquitto`):

```bash
# sobe um dispositivo simulado "device-001" no broker local
pnpm dev:simulator

# sobrescreve o id do dispositivo (útil para rodar vários dispositivos)
pnpm dev:simulator --externalId=device-002
# ...ou via variável de ambiente
DEVICE_EXTERNAL_ID=device-002 pnpm dev:simulator
```

Rode várias instâncias (um processo por dispositivo simulado) apontando para o mesmo broker.

## Executar (build + produção)

Fora do dev, o simulador lê a configuração a partir do ambiente do processo. Diferente da
API, ele **não** carrega um arquivo `.env` automaticamente — exporte as variáveis no shell
ou passe-as inline:

```bash
# apontando para o EMQX Cloud, por exemplo
MQTT_URL=mqtts://host:8883 MQTT_USERNAME=... MQTT_PASSWORD=... DEVICE_EXTERNAL_ID=device-001 \
  pnpm --filter @mqtt-poc/device-simulator start

# sobrescreve o id do dispositivo via CLI (tem precedência sobre DEVICE_EXTERNAL_ID)
pnpm --filter @mqtt-poc/device-simulator start -- --externalId=device-002
```

(O `start` roda `node dist/index.js`, então rode `pnpm --filter @mqtt-poc/device-simulator build` antes.)

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `MQTT_URL` | — (obrigatória) | URL do broker, ex.: `mqtt://localhost:1883` ou `mqtts://host:8883` para o EMQX Cloud |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | Credenciais do broker |
| `MQTT_QOS` | `1` | QoS (0/1/2) para subscribe/publish/status/LWT |
| `DEVICE_EXTERNAL_ID` | — (obrigatória, exceto se usar `--externalId`) | Identificador do dispositivo usado nos tópicos |
| `SIMULATOR_RESPONSE_DELAY_MS` | `1000` | Atraso antes de responder a um comando |
| `SIMULATOR_FAILURE_RATE` | `0` | Probabilidade (0..1) de uma resposta ser `FAILED` em vez de `ACKED` |
