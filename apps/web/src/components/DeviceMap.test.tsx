import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeviceMap } from './DeviceMap'
import type { TelemetryPoint } from '../api/types'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile" />,
  Polyline: ({ positions }: any) => <div data-testid="polyline" data-count={positions.length} />,
  Marker: ({ position }: any) => <div data-testid="marker" data-pos={position.join(',')} />,
  useMap: () => ({ setView: vi.fn() }),
}))
vi.mock('leaflet', () => ({ default: { icon: () => ({}) } }))

const pts: TelemetryPoint[] = [
  { lat: 1, lon: 2, recordedAt: 't1' },
  { lat: 3, lon: 4, recordedAt: 't2' },
]

describe('DeviceMap', () => {
  it('renders a polyline over all points and a marker at the latest', () => {
    render(<DeviceMap points={pts} />)
    expect(screen.getByTestId('polyline').getAttribute('data-count')).toBe('2')
    expect(screen.getByTestId('marker').getAttribute('data-pos')).toBe('3,4')
  })

  it('renders a placeholder when there are no points', () => {
    render(<DeviceMap points={[]} />)
    expect(screen.queryByTestId('marker')).toBeNull()
    expect(screen.getByText(/sem telemetria/i)).toBeInTheDocument()
  })
})
