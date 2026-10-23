import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toUserMessage } from '@/lib/errors'
import { salesKeys } from './sales-api'

/**
 * Runs a sales write and refreshes every sales query (sessions, orders,
 * summaries) plus customers, since payments can create debts.
 *
 * The refresh is NOT awaited on purpose: the caller's own onSuccess (show the
 * close result, print the receipt...) must run first. If we waited, the refetch
 * could unmount that screen (e.g. the session is now closed) and React Query
 * skips callbacks of unmounted components.
 */
export function useSalesMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  successMessage?: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      if (successMessage) toast.success(successMessage)
    },
    onError: (error) => toast.error(toUserMessage(error)),
  })
}
