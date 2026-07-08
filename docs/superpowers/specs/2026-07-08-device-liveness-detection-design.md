# Detecção de Liveness de Dispositivos — Design (melhoria futura)

**Data:** 2026-07-08
**Status:** Implementado (Opção A — heartbeat no simulador + timeout de liveness no servidor)

## Contexto

O status de um dispositivo (`ONLINE` / `OFFLINE` / `UNKNOWN`) é atualizado quando a API
recebe uma mensagem no tópico `devices/{externalId}/status` (ver
[design de comandos](./2026-07-05-mqtt-device-commands-design.md)). Hoje o valor no banco
reflete apenas **a última mensagem de status recebida** — não existe nenhuma noção de
"o dispositivo está de fato conectado agora".

Isso foi observado na prática: a lista da web mostrava **2 dispositivos ONLINE** enquanto
apenas o `device-001` estava rodando de verdade. O `device-002` era um **fantasma**.

## Problemática

### Sintoma
Dispositivos aparecem `ONLINE` na aplicação sem estarem conectados ("fantasmas").

### Causa raiz
Um dispositivo só transita para `OFFLINE` quando **chega uma mensagem explícita** de
`offline` — publicada pelo próprio device no shutdown gracioso, ou pelo broker via
**LWT (Last Will and Testament)** numa desconexão abrupta. Não há detecção de liveness
baseada no tempo. Consequências:

1. **Fantasmas por fixture / dado manual.** O `device-002` foi inserido com `lastSeenAt`
   chumbado (`2026-07-05T10:00:00Z`) — inclusive **anterior** ao seu `createdAt`
   (`2026-07-05T19:53:50Z`), o que é impossível num fluxo real. Como nunca teve uma
   conexão real, nunca existiu um LWT para marcá-lo offline. Fica `ONLINE` para sempre.
2. **LWT perdido.** Se o broker reinicia, se a API está fora do ar quando o LWT é
   publicado, ou se a sessão do broker é perdida, a transição para offline nunca é
   registrada.

### Fato estrutural que condiciona a solução
O `lastSeenAt` **só é atualizado na conexão** do dispositivo. O simulador publica
`online` uma única vez em `handleConnect()` e não emite heartbeat periódico
(ver `apps/device-simulator/src/simulator.ts`). Portanto, qualquer estratégia de
"timeout por `lastSeenAt` velho" **exige antes** que os dispositivos passem a emitir um
heartbeat — caso contrário um device vivo há mais que o limite seria marcado offline
incorretamente.

## Como funciona liveness em dispositivos reais

Princípio central: **liveness é detectar silêncio, não receber um aviso de "morri".**
Um device não anuncia a própria morte; ele **para de emitir sinal**, e o observador
(broker ou servidor) infere a queda pela **ausência** do sinal esperado. Um device vivo
fala; um device morto silencia. Por isso a pergunta "como ele republica se está offline?"
não se aplica: ele republica *enquanto vivo* — parar de republicar já é o sinal.

Existem dois mecanismos complementares:

1. **Keep-alive + LWT (nível do broker) — já presente no projeto.**
   Ao conectar, o device combina com o broker um `keepAlive` e uma mensagem de testamento
   (LWT). Enquanto vivo, envia PINGs periódicos. Se o broker fica ~1,5× `keepAlive` sem
   ouvir o device, declara-o morto e **publica o LWT `offline` em nome dele**. No projeto,
   `buildConnectOptions` já define o `will`; como `keepAlive` não é configurado, vale o
   default do `mqtt.js` (**60s**). Por isso um `kill -9` no simulador acaba virando offline
   sozinho após ~60–90s.

2. **Heartbeat de aplicação + timeout (nível do servidor) — ausente hoje.**
   O device republica periodicamente uma mensagem (ex.: `online`) a cada N segundos. O
   servidor guarda o `lastSeenAt` e um task marca `OFFLINE` quem ficou sem falar além do
   limite. É um "dead man's switch" no relógio do próprio servidor, independente do broker.

### Cobertura de cada mecanismo

| Cenário | LWT (broker) | Heartbeat + timeout (servidor) |
|---|---|---|
| Queda abrupta (kill -9, cabo) | ✅ ~60–90s | ✅ conforme o limite |
| Broker/API reiniciado, LWT perdido | ❌ | ✅ |
| Fantasma por fixture (sem conexão real) | ❌ | ✅ |
| Precisa alterar o simulador | ❌ | ✅ (adicionar heartbeat) |

## Opções de solução

### Opção A — Heartbeat + timeout (recomendada para um POC realista)
- **Simulador:** publicar `online` periodicamente (ex.: a cada `SIMULATOR_HEARTBEAT_MS`,
  default sugerido 15–30s), usando o `publishStatus('online')` já existente num
  `setInterval`, parando no `stop()`.
- **Servidor:** um task `@Interval` (espelhando `ExpireCommandsTask`) que marca `OFFLINE`
  os devices `ONLINE` cujo `lastSeenAt` seja mais antigo que `DEVICE_OFFLINE_TIMEOUT_MS`
  (default sugerido 2–3× o heartbeat, ex.: 45–60s). Cada transição emite
  `device.status-changed`, reaproveitando o `StatusGateway` (a web já reflete em tempo real
  após a Opção B do realtime).
- **Prós:** resolve fantasmas e LWT perdido; independe do broker; usa padrões já existentes.
- **Contras:** mexe em dois apps; tráfego extra de heartbeat.

### Opção B — Híbrido (LWT + heartbeat)
Igual à Opção A, preservando o `will` para offline rápido (~1s na queda abrupta) e usando o
timeout como rede de segurança para os furos do LWT. Na prática o LWT **já fica ativo**, então
esta opção é essencialmente a Opção A com o `will` mantido — a diferença é sobretudo de ênfase
e de configurar um `keepAlive` explícito no simulador.
- **Prós:** offline mais rápido no caso comum + robustez do timeout; mais próximo de produção.
- **Contras:** maior superfície de configuração/testes.

### Opção C — Apenas limpar o fantasma
Sem heartbeat nem timeout. Confiar no LWT e apenas corrigir/remover o registro ruim do
`device-002` (seed/limpeza).
- **Prós:** esforço mínimo, zero código novo de liveness.
- **Contras:** não previne fantasmas futuros nem LWT perdido; trata o sintoma, não a causa.

## Recomendação

**Opção A (ou B, que é A com o `will` preservado).** É a única que ataca a causa raiz —
detectar ausência de sinal — e reaproveita padrões já no código (`@Interval`,
`StatusGateway`, `publishStatus`). A Opção C fica como paliativo imediato se for preciso
"limpar a tela" antes de investir na detecção real.

## Esboço de implementação (para quando for priorizado)

**Configuração (env vars):**
- `SIMULATOR_HEARTBEAT_MS` (simulador, default ~15000)
- `DEVICE_OFFLINE_TIMEOUT_MS` (servidor, default ~45000)
- `DEVICE_LIVENESS_CHECK_INTERVAL_MS` (servidor, default ~10000)

**Simulador** (`apps/device-simulator/src/simulator.ts`):
- Em `handleConnect()`, iniciar `setInterval(() => this.publishStatus('online'), heartbeatMs)`.
- Em `stop()`, `clearInterval` antes do `client.end()`.

**Servidor:**
- `MarkStaleDevicesOfflineUseCase` (application): recebe `timeoutMs`, calcula
  `cutoff = now - timeoutMs`, atualiza para `OFFLINE` os devices `ONLINE` com
  `lastSeenAt < cutoff`, retorna os afetados. Espelha `ExpireStaleCommandsUseCase`.
- `DeviceLivenessTask` (`@Interval`): chama o use case e emite `device.status-changed` por
  device afetado (para o `StatusGateway` propagar à web).
- Repositório: método `markStaleOffline(cutoff)` (update em massa com filtro por status +
  `lastSeenAt`).

**Testes (TDD):**
- Use case: marca offline apenas quem passou do cutoff; não toca `OFFLINE`/`UNKNOWN`; não
  toca quem está fresco.
- Task: chama o use case com o timeout configurado e emite um evento por device afetado.
- Simulador: agenda o heartbeat no connect e limpa no stop (usando `deps.setTimeout`/timer
  injetável já presente).

## Questões em aberto
- Valores default de heartbeat/timeout (equilíbrio entre detecção rápida e tráfego).
- Configurar `keepAlive` explícito no simulador para tornar o comportamento do LWT
  determinístico (em vez de depender do default do `mqtt.js`).
- Tratamento do `device-002` legado: corrigir via limpeza pontual ou deixar o próprio
  timeout resolvê-lo na primeira execução.
