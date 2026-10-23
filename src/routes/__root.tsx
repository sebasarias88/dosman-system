import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { OfflineGuard } from '@/components/layout/offline-guard'
import { PwaUpdatePrompt } from '@/components/layout/pwa-update-prompt'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      <OfflineGuard />
      <PwaUpdatePrompt />
      <Toaster theme="dark" position="top-center" richColors closeButton />
    </>
  )
}
