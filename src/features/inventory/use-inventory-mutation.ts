import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { catalogQuery } from '@/features/catalog/catalog-api'
import { salesKeys } from '@/features/sales/sales-api'
import { toUserMessage } from '@/lib/errors'
import { inventoryKeys } from './inventory-api'

/**
 * Runs an inventory write and refreshes stock, transfers and purchases.
 * Purchases change supply costs (catalog) and may take money from the drawer
 * (cash screens), so those are refreshed too.
 */
export function useInventoryMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  successMessage?: string | ((result: TResult) => string),
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      void queryClient.invalidateQueries({ queryKey: catalogQuery.queryKey })
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error))
    },
  })
}
