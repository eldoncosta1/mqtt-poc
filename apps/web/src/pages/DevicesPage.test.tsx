import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DevicesPage } from './DevicesPage'
import { devicesApi } from '../api/devices'
import type { Device } from '../api/types'

vi.mock('../api/devices')

const socketHandlers: Record<string, (...args: any[]) => void> = {}
const fakeSocket = {
  on: vi.fn((event: string, cb: (...args: any[]) => void) => {
    socketHandlers[event] = cb
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
}
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }))

const device: Device = {
  id: 'd1', externalId: 'device-1', name: 'Sensor 1',
  status: 'ONLINE', lastSeenAt: null, createdAt: '', updatedAt: '',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(socketHandlers)) delete socketHandlers[k]
})

describe('DevicesPage', () => {
  it('renders the list of devices from the API', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([device])
    renderPage()
    expect(await screen.findByText('Sensor 1')).toBeInTheDocument()
    expect(screen.getByText('device-1')).toBeInTheDocument()
  })

  it('updates a device status in realtime without a refetch', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([{ ...device, status: 'OFFLINE' }])
    renderPage()
    expect(await screen.findByText('OFFLINE')).toBeInTheDocument()

    act(() => {
      socketHandlers['device:status']({ externalId: 'device-1', status: 'ONLINE', lastSeenAt: null })
    })

    expect(await screen.findByText('ONLINE')).toBeInTheDocument()
    expect(screen.queryByText('OFFLINE')).not.toBeInTheDocument()
    expect(devicesApi.list).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when there are no devices', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/nenhum dispositivo/i)).toBeInTheDocument()
  })

  it('registers a new device and refreshes the list', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue([])
    vi.mocked(devicesApi.create).mockResolvedValue({ ...device, id: 'd2', externalId: 'device-2', name: 'Sensor 2', status: 'UNKNOWN' })
    renderPage()
    await screen.findByText(/nenhum dispositivo/i)
    await userEvent.type(screen.getByLabelText('External ID'), 'device-2')
    await userEvent.type(screen.getByLabelText('Nome'), 'Sensor 2')
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }))
    await waitFor(() => expect(devicesApi.create).toHaveBeenCalledWith({ externalId: 'device-2', name: 'Sensor 2' }))
  })
})
