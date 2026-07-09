import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { TelemetryPoint } from '../api/types'

// react-leaflet não resolve os ícones default com bundlers; montamos um ícone explícito.
const deviceIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center)
  }, [center, map])
  return null
}

export function DeviceMap({ points }: { points: TelemetryPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
        Sem telemetria ainda para este dispositivo.
      </div>
    )
  }

  const positions = points.map((p) => [p.lat, p.lon] as [number, number])
  const latest = positions[positions.length - 1]

  return (
    <div className="h-80 overflow-hidden rounded-lg border border-gray-200">
      <MapContainer center={latest} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={positions} />
        <Marker position={latest} icon={deviceIcon} />
        <Recenter center={latest} />
      </MapContainer>
    </div>
  )
}
