import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { salesKeys } from '@/features/sales/sales-api'
import { toUserMessage } from '@/lib/errors'
import { expenseKeys } from './expenses-api'

/**
 * Runs an expense write and refreshes expenses, reports and the cash screens
 * (an expense paid from the drawer is also a cash movement).
 */
export function useExpenseMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  successMessage?: string | ((result: TResult) => string),
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    // Waits for the expense lists so the switches and the list never show the
    // old value after the spinner stops.
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      await queryClient.invalidateQueries({ queryKey: expenseKeys.all })
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error))
    },
  })
}
