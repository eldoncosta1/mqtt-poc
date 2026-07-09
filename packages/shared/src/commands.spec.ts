import { describe, it, expect } from 'vitest'
import { TELEMETRY_START_COMMAND, TELEMETRY_STOP_COMMAND } from './commands'

describe('telemetry command constants', () => {
  it('exposes the exact command type strings', () => {
    expect(TELEMETRY_START_COMMAND).toBe('START_TELEMETRY')
    expect(TELEMETRY_STOP_COMMAND).toBe('STOP_TELEMETRY')
  })
})
