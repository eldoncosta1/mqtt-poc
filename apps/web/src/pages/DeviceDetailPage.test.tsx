import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DeviceDetailPage } from './DeviceDetailPage'
import { devicesApi } from '../api/devices'
import { commandsApi } from '../api/commands'
import type { Command, Device } from '../api/types'
import { useDeviceRealtime } from '../realtime/useDeviceRealtime'

vi.mock('../api/devices')
vi.mock('../api/commands')
vi.mock('../realtime/useDeviceRealtime', () => ({ useDeviceRealtime: vi.fn() }))

const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'ONLINE', lastSeenAt: null, createdAt: '', updatedAt: '',
}
const command: Command = {
  id: 'c1', deviceId: 'd1', type: 'REBOOT', payload: null,
  status: 'PENDING', response: null, createdAt: '', respondedAt: null,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/devices/d1']}>
        <Routes>
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('DeviceDetailPage', () => {
  it('renders the device name, status, and its commands', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([command, { ...command, id: 'other', deviceId: 'd2' }])
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Sensor 1' })).toBeInTheDocument()
    expect(await screen.findByText('REBOOT')).toBeInTheDocument()
    // only this device's command is shown (deviceId d1), not the d2 one
    expect(screen.getAllByText('REBOOT')).toHaveLength(1)
  })

  it('sends a command with the entered type', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    vi.mocked(commandsApi.create).mockResolvedValue({ ...command, id: 'c2', type: 'SET_CONFIG' })
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.type(screen.getByLabelText('Tipo do comando'), 'SET_CONFIG')
    await userEvent.click(screen.getByRole('button', { name: /enviar comando/i }))
    await waitFor(() => expect(commandsApi.create).toHaveBeenCalledWith({ deviceId: 'd1', type: 'SET_CONFIG' }))
  })

  it('shows an error and does not submit when the payload is invalid JSON', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.type(screen.getByLabelText('Tipo do comando'), 'REBOOT')
    await userEvent.type(screen.getByLabelText(/payload/i), '{{not json')
    await userEvent.click(screen.getByRole('button', { name: /enviar comando/i }))
    expect(await screen.findByText(/payload inválido/i)).toBeInTheDocument()
    expect(commandsApi.create).not.toHaveBeenCalled()
  })

  it('rejects a non-object JSON payload (e.g. a bare number) without submitting', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    await userEvent.type(screen.getByLabelText('Tipo do comando'), 'REBOOT')
    await userEvent.type(screen.getByLabelText(/payload/i), '42')
    await userEvent.click(screen.getByRole('button', { name: /enviar comando/i }))
    expect(await screen.findByText(/precisa ser um objeto json/i)).toBeInTheDocument()
    expect(commandsApi.create).not.toHaveBeenCalled()
  })

  it('shows an error state when the commands list fails to load', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    expect(await screen.findByText(/erro ao carregar comandos/i)).toBeInTheDocument()
    expect(screen.queryByText(/nenhum comando enviado/i)).not.toBeInTheDocument()
  })

  it('applies a realtime command:updated event to the commands list', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device)
    vi.mocked(commandsApi.list).mockResolvedValue([command])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    expect(await screen.findByText('PENDING')).toBeInTheDocument()

    const calls = vi.mocked(useDeviceRealtime).mock.calls
    const handlers = calls[calls.length - 1][1]
    act(() => {
      handlers.onCommandUpdated!({ commandId: 'c1', status: 'ACKED', response: null, respondedAt: '2026-07-08T10:00:00.000Z' })
    })
    expect(await screen.findByText('ACKED')).toBeInTheDocument()
  })

  it('applies a realtime device:status event to the device badge', async () => {
    vi.mocked(devicesApi.get).mockResolvedValue(device) // starts ONLINE
    vi.mocked(commandsApi.list).mockResolvedValue([])
    renderPage()
    await screen.findByRole('heading', { name: 'Sensor 1' })
    expect(await screen.findByText('ONLINE')).toBeInTheDocument()

    const calls = vi.mocked(useDeviceRealtime).mock.calls
    const handlers = calls[calls.length - 1][1]
    act(() => {
      handlers.onDeviceStatus!({ externalId: 'device-1', status: 'OFFLINE', lastSeenAt: '2026-07-08T10:05:00.000Z' })
    })
    expect(await screen.findByText('OFFLINE')).toBeInTheDocument()
  })
})
