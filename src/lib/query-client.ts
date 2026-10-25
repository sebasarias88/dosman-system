import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for a minute: fewer repeated requests (Supabase egress).
      // Live screens don't depend on this: Realtime refreshes them on every change.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Never retry money or stock operations automatically: a retry after a
      // timeout could register the same sale twice.
      retry: false,
    },
  },
})
