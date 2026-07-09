import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '../api/client'
import type { CommandUpdate, DeviceStatusUpdate } from './merge'
import type { TelemetryPoint } from '../api/types'

export interface DeviceRealtimeHandlers {
  onCommandUpdated?: (update: CommandUpdate) => void
  onDeviceStatus?: (update: DeviceStatusUpdate) => void
  onTelemetry?: (point: TelemetryPoint) => void
}

export function useDeviceRealtime(externalId: string | undefined, handlers: DeviceRealtimeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!externalId) return

    const socket = io(API_URL, { transports: ['websocket'] })
    socket.on('connect', () => socket.emit('subscribe:device', externalId))
    socket.on('command:updated', (update: CommandUpdate) => handlersRef.current.onCommandUpdated?.(update))
    socket.on('device:status', (update: DeviceStatusUpdate) => handlersRef.current.onDeviceStatus?.(update))
    socket.on('telemetry:point', (point: TelemetryPoint) => handlersRef.current.onTelemetry?.(point))

    return () => {
      socket.disconnect()
    }
  }, [externalId])
}
