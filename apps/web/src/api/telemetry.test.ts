import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './client'
import { telemetryApi } from './telemetry'

describe('telemetryApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('list() GETs /devices/:id/telemetry with the limit param', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ lat: 1, lon: 2, recordedAt: 'x' }] })
    const result = await telemetryApi.list('d1', 50)
    expect(api.get).toHaveBeenCalledWith('/devices/d1/telemetry', { params: { limit: 50 } })
    expect(result).toEqual([{ lat: 1, lon: 2, recordedAt: 'x' }])
  })

  it('list() defaults the limit to 100', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] })
    await telemetryApi.list('d1')
    expect(api.get).toHaveBeenCalledWith('/devices/d1/telemetry', { params: { limit: 100 } })
  })
})
