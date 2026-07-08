import type { CommandStatus, DeviceStatus } from '../api/types'

const COLORS: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-800',
  OFFLINE: 'bg-gray-200 text-gray-700',
  UNKNOWN: 'bg-yellow-100 text-yellow-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  ACKED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  PUBLISH_FAILED: 'bg-red-100 text-red-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
}

export function StatusBadge({ status }: { status: DeviceStatus | CommandStatus }) {
  const color = COLORS[status] ?? 'bg-gray-100 text-gray-700'
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>
}
