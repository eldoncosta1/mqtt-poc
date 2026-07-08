import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

interface CommandUpdatedEvent {
  externalId: string
  commandId: string
  status: string
  response: unknown
  respondedAt: Date | null
}

interface DeviceStatusChangedEvent {
  externalId: string
  status: string
  lastSeenAt: Date
}

interface TelemetryRecordedEvent {
  externalId: string
  lat: number
  lon: number
  recordedAt: Date
}

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } })
@Injectable()
export class StatusGateway {
  @WebSocketServer()
  server: Server

  @SubscribeMessage('subscribe:device')
  handleSubscribe(@MessageBody() externalId: string, @ConnectedSocket() client: Socket) {
    client.join(`device:${externalId}`)
  }

  @SubscribeMessage('subscribe:devices')
  handleSubscribeDevices(@ConnectedSocket() client: Socket) {
    client.join('devices')
  }

  @OnEvent('command.updated')
  handleCommandUpdated(event: CommandUpdatedEvent) {
    this.server.to(`device:${event.externalId}`).emit('command:updated', {
      commandId: event.commandId,
      status: event.status,
      response: event.response,
      respondedAt: event.respondedAt,
    })
  }

  @OnEvent('device.status-changed')
  handleDeviceStatusChanged(event: DeviceStatusChangedEvent) {
    this.server.to(`device:${event.externalId}`).to('devices').emit('device:status', {
      externalId: event.externalId,
      status: event.status,
      lastSeenAt: event.lastSeenAt,
    })
  }

  @OnEvent('telemetry.recorded')
  handleTelemetry(event: TelemetryRecordedEvent) {
    this.server.to(`device:${event.externalId}`).emit('telemetry:point', {
      lat: event.lat, lon: event.lon, recordedAt: event.recordedAt,
    })
  }
}
