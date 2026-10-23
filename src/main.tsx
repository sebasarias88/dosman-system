import '@/styles/index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Spinner } from '@/components/ui/spinner'
import { staffContextQuery } from '@/features/auth/auth-api'
import { queryClient } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import { routeTree } from './routeTree.gen'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPendingComponent: () => (
    <div className="grid h-full place-items-center text-fg-subtle">
      <Spinner />
    </div>
  ),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    /** Full-screen work modules (POS, tables) use an icon-only sidebar. */
    compactShell?: boolean
  }
}

// Keep the cached staff context in sync with Supabase sessions (sign out in
// another tab, expired refresh token...).
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    queryClient.setQueryData(staffContextQuery.queryKey, null)
    void router.invalidate()
  }
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
