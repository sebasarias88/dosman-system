import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useStaff } from '@/features/auth/use-staff'
import { supabase } from '@/lib/supabase'
import { inventoryKeys } from '@/features/inventory/inventory-api'
import { salesKeys } from './sales-api'

/**
 * Listens to order changes of the active branch (Supabase Realtime) and
 * refreshes the sales screens on every device: a waiter's order shows up in
 * the cashier and in the kitchen right away, and transfers reach the
 * receiving branch at once. Realtime respects RLS, so each
 * device only receives its own branch. Changes arriving together are batched.
 */
export function BranchRealtime() {
  const { activeBranch } = useStaff()
  const queryClient = useQueryClient()
  const branchId = activeBranch?.id

  useEffect(() => {
    if (!branchId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: salesKeys.all }), 250)
    }
    const refreshTransfers = () => void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    const filter = `branch_id=eq.${branchId}`
    const channel = supabase
      .channel(`branch-orders-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter }, refresh)
      // Merchandise sent to this branch shows up right away.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfers', filter: `to_branch_id=eq.${branchId}` },
        refreshTransfers,
      )
      .subscribe()

    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [branchId, queryClient])

  return null
}
