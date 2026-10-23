import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
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
