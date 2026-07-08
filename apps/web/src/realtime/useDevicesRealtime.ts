import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '../api/client'
import type { DeviceStatusUpdate } from './merge'

export interface DevicesRealtimeHandlers {
  onDeviceStatus?: (update: DeviceStatusUpdate) => void
}

export function useDevicesRealtime(handlers: DevicesRealtimeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket'] })
    socket.on('connect', () => socket.emit('subscribe:devices'))
    socket.on('device:status', (update: DeviceStatusUpdate) => handlersRef.current.onDeviceStatus?.(update))

    return () => {
      socket.disconnect()
    }
  }, [])
}
