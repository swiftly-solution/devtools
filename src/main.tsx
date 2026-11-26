import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import './index.css'
import { Layout } from './Layout'
import { CrashAnalyzer } from './crash/CrashAnalyzer'
import { ProfilerAnalyzer } from './profiler/ProfilerAnalyzer'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/crash-analyzer" replace /> },
      { path: 'crash-analyzer', element: <CrashAnalyzer /> },
      { path: 'profiler-analyzer', element: <ProfilerAnalyzer /> },
      { path: '*', element: <Navigate to="/crash-analyzer" replace /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
