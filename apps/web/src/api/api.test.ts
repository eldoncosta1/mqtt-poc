import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './client'
import { devicesApi } from './devices'
import { commandsApi } from './commands'

describe('devicesApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /devices and returns the data array', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'd1' }] })
    const result = await devicesApi.list()
    expect(api.get).toHaveBeenCalledWith('/devices')
    expect(result).toEqual([{ id: 'd1' }])
  })

  it('get(id) GETs /devices/:id', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { id: 'd1' } })
    const result = await devicesApi.get('d1')
    expect(api.get).toHaveBeenCalledWith('/devices/d1')
    expect(result).toEqual({ id: 'd1' })
  })

  it('create() POSTs /devices with the body and returns the created device', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'd2' } })
    const result = await devicesApi.create({ externalId: 'device-2', name: 'Sensor 2' })
    expect(api.post).toHaveBeenCalledWith('/devices', { externalId: 'device-2', name: 'Sensor 2' })
    expect(result).toEqual({ id: 'd2' })
  })
})

describe('commandsApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /commands', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'c1' }] })
    const result = await commandsApi.list()
    expect(api.get).toHaveBeenCalledWith('/commands')
    expect(result).toEqual([{ id: 'c1' }])
  })

  it('get(id) GETs /commands/:id', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { id: 'c1' } })
    const result = await commandsApi.get('c1')
    expect(api.get).toHaveBeenCalledWith('/commands/c1')
    expect(result).toEqual({ id: 'c1' })
  })

  it('create() POSTs /commands with the body', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'c2' } })
    const result = await commandsApi.create({ deviceId: 'd1', type: 'REBOOT' })
    expect(api.post).toHaveBeenCalledWith('/commands', { deviceId: 'd1', type: 'REBOOT' })
    expect(result).toEqual({ id: 'c2' })
  })
})
