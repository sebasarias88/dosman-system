import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toUserMessage } from '@/lib/errors'
import { catalogQuery } from './catalog-api'

/**
 * Runs a catalog write, refreshes the catalog and shows the result. Errors
 * thrown with our own Spanish message (e.g. image upload) are shown as is.
 */
export function useCatalogMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  successMessage: string | ((result: TResult) => string),
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: catalogQuery.queryKey })
      toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage)
    },
    onError: (error) => {
      toast.error(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error))
    },
  })
}
