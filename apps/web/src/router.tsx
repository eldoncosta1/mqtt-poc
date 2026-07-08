import { createBrowserRouter } from 'react-router-dom'
import { DevicesPage } from './pages/DevicesPage'
import { DeviceDetailPage } from './pages/DeviceDetailPage'

export const router = createBrowserRouter([
  { path: '/', element: <DevicesPage /> },
  { path: '/devices/:id', element: <DeviceDetailPage /> },
])
