import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toUserMessage } from '@/lib/errors'

/**
 * Settings change what every screen shows (branch names, payment methods),
 * so the shared queries are refreshed too.
 */
export function useSettingsMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  successMessage?: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    // Settings are edited in place (switches, order arrows): waiting for the
    // refresh keeps the control busy until it shows the saved value.
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-context'] })
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
      void queryClient.invalidateQueries({ queryKey: ['branches'] })
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      if (successMessage) toast.success(successMessage)
    },
    onError: (error) =>
      toast.error(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error)),
  })
}
