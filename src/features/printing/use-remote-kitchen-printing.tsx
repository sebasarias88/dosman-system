import { useEffect, useRef } from 'react'
import type { Order } from '@/features/sales/types'
import { printTicket } from './print-store'
import { KitchenTicket } from './tickets'

interface Options {
  /** Print on this device (cashier PC with kitchen tickets turned on). */
  enabled: boolean
  /** True once the open orders have loaded at least once. */
  loaded: boolean
  orders: Order[]
  myId: string
  branchName: string
}

/**
 * Prints the kitchen ticket of items that other devices add (a waiter taking
 * an order on a phone). What already exists when the screen opens is only
 * remembered, never printed, so reopening the POS doesn't reprint old orders.
 * Items this person sends are printed by the POS itself.
 */
export function useRemoteKitchenPrinting({ enabled, loaded, orders, myId, branchName }: Options) {
  const seen = useRef<Set<string> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    // The list is empty while loading; remembering that would reprint everything.
    if (!loaded) return
    if (seen.current === null) {
      seen.current = new Set(orders.flatMap((o) => o.order_items.map((i) => i.id)))
      return
    }
    const known = seen.current

    for (const order of orders) {
      const fresh = order.order_items.filter(
        (item) =>
          !known.has(item.id) && !item.voided_at && item.requires_preparation && item.created_by !== myId,
      )
      const isAddition = order.order_items.some((item) => known.has(item.id))
      order.order_items.forEach((item) => known.add(item.id))

      if (!enabled || fresh.length === 0) continue
      // One ticket at a time: the browser can only show one print job.
      queue.current = queue.current.then(() =>
        printTicket(
          <KitchenTicket order={order} items={fresh} branchName={branchName} isAddition={isAddition} />,
        ),
      )
    }
  }, [orders, loaded, enabled, myId, branchName])
}
