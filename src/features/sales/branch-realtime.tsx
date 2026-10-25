import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useStaff } from '@/features/auth/use-staff'
import { setRealtimeConnected } from '@/lib/realtime-status'
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
    // Charging an order fires several changes (order, items, payments) in a
    // few milliseconds: wait a moment and refresh once, to keep egress low.
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: salesKeys.all }), 800)
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
      .subscribe((status) => {
        const live = status === 'SUBSCRIBED'
        setRealtimeConnected(live)
        // Connected again (or just lost): refresh once. That catches up what was
        // missed and lets the live screens switch polling on or off.
        if (live || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') refresh()
      })

    return () => {
      clearTimeout(timer)
      setRealtimeConnected(false)
      void supabase.removeChannel(channel)
    }
  }, [branchId, queryClient])

  return null
}
