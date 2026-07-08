import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../api/devices'
import type { Device } from '../api/types'
import { StatusBadge } from '../components/StatusBadge'
import { useDevicesRealtime } from '../realtime/useDevicesRealtime'
import { applyDeviceStatusToList } from '../realtime/merge'

export function DevicesPage() {
  const queryClient = useQueryClient()
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: devicesApi.list })
  const [externalId, setExternalId] = useState('')
  const [name, setName] = useState('')

  useDevicesRealtime({
    onDeviceStatus: (update) => {
      queryClient.setQueryData<Device[]>(['devices'], (old) => (old ? applyDeviceStatusToList(old, update) : old))
    },
  })

  const createDevice = useMutation({
    mutationFn: (dto: { externalId: string; name: string }) => devicesApi.create(dto),
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
