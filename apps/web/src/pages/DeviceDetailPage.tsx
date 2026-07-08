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
    mutationFn: (dto: { deviceId: string; type: string; payload?: Record<string, unknown> }) =>
      commandsApi.create(dto),
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
      let parsed: unknown
      try {
        parsed = JSON.parse(payloadText)
      } catch {
        setPayloadError('Payload inválido: precisa ser um JSON válido.')
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setPayloadError('Payload inválido: precisa ser um objeto JSON.')
        return
      }
      payload = parsed as Record<string, unknown>
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
      {commandsQuery.isError && <p className="text-red-600">Erro ao carregar comandos.</p>}
      {deviceCommands.length === 0 && !commandsQuery.isLoading && !commandsQuery.isError && (
        <p className="text-gray-500">Nenhum comando enviado para este dispositivo.</p>
      )}
      {deviceCommands.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {deviceCommands.map((command) => (
            <li key={command.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900">{command.type}</span>
                  <span className="text-xs text-gray-500">{command.id}</span>
                </div>
                <StatusBadge status={command.status} />
              </div>
              {command.payload != null && (
                <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs text-gray-700">
                  {JSON.stringify(command.payload, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
