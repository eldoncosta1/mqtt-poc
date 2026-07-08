# device-simulator

Processo standalone que simula um dispositivo IoT no broker MQTT, permitindo exercitar
o fluxo completo de comandos (API → broker → dispositivo → resposta → API) sem hardware.

Ele se conecta com `mqtt.js`, assina `devices/{externalId}/commands`, responde em
`devices/{externalId}/responses` (ACKED/FAILED após um atraso) e publica o status do
dispositivo em `devices/{externalId}/status` (`online` retido ao conectar, `offline` via
LWT ao desconectar).

## Executar

O simulador lê a configuração a partir do ambiente do processo. Diferente da API, ele
**não** carrega um arquivo `.env` automaticamente — exporte as variáveis no shell ou
passe-as inline:

```bash
# contra o Mosquitto local (docker compose up -d mosquitto)
MQTT_URL=mqtt://localhost:1883 DEVICE_EXTERNAL_ID=device-001 \
  pnpm --filter @mqtt-poc/device-simulator start

# sobrescreve o id do dispositivo via CLI (tem precedência sobre DEVICE_EXTERNAL_ID)
pnpm --filter @mqtt-poc/device-simulator start -- --externalId=device-002
```

Rode várias instâncias (um processo por dispositivo simulado) apontando para o mesmo broker.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `MQTT_URL` | — (obrigatória) | URL do broker, ex.: `mqtt://localhost:1883` ou `mqtts://host:8883` para o EMQX Cloud |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | Credenciais do broker |
| `MQTT_QOS` | `1` | QoS (0/1/2) para subscribe/publish/status/LWT |
| `DEVICE_EXTERNAL_ID` | — (obrigatória, exceto se usar `--externalId`) | Identificador do dispositivo usado nos tópicos |
| `SIMULATOR_RESPONSE_DELAY_MS` | `1000` | Atraso antes de responder a um comando |
| `SIMULATOR_FAILURE_RATE` | `0` | Probabilidade (0..1) de uma resposta ser `FAILED` em vez de `ACKED` |
