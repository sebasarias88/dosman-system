import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  CashMovement,
  CashSession,
  CashSummary,
  Customer,
  DiningTable,
  KitchenItem,
  Order,
  OrderType,
  PaymentMethod,
  PrepStatus,
  Zone,
} from './types'

/** Every sales query key starts with 'sales', so one invalidation refreshes them all. */
export const salesKeys = {
  all: ['sales'] as const,
  openSession: (branchId: string) => ['sales', 'open-session', branchId] as const,
  summary: (sessionId: string) => ['sales', 'summary', sessionId] as const,
  movements: (sessionId: string) => ['sales', 'movements', sessionId] as const,
  sessions: (branchId: string) => ['sales', 'sessions', branchId] as const,
  openOrders: (branchId: string) => ['sales', 'open-orders', branchId] as const,
  kitchen: (branchId: string) => ['sales', 'kitchen', branchId] as const,
  recentOrders: (sessionId: string) => ['sales', 'recent-orders', sessionId] as const,
}

const SESSION_COLUMNS =
  'id, branch_id, business_date, status, opening_amount, opened_at, opened_by, expected_cash, counted_cash, difference, close_notes, closed_at'

const ORDER_SELECT = `
  id, branch_id, order_number, order_type, status, table_id, park_note, customer_id, delivery_address,
  delivery_fee, courier_name, subtotal, discount_amount, discount_reason, tip_amount, total, created_at, paid_at,
  dining_tables(name),
  customers(id, name, phone, address),
  order_items(id, variant_id, product_name, variant_name, quantity, unit_price, add_ons, line_total, notes,
              requires_preparation, prep_status, created_by, created_at, voided_at, void_reason),
  payments(method_code, amount, cash_received, change_given)`

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export const paymentMethodsQuery = queryOptions({
  queryKey: ['payment-methods'],
  staleTime: 60 * 60_000,
  queryFn: async () =>
    unwrap<PaymentMethod[]>(
      await supabase
        .from('payment_methods')
        .select('code, name, kind, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
    ),
})

export const tablesQuery = (branchId: string) =>
  queryOptions({
    queryKey: ['tables', branchId],
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap<DiningTable[]>(
        await supabase
          .from('dining_tables')
          .select('id, name, zone_id, sort_order, is_active, zones(name, sort_order)')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('sort_order'),
      ),
  })

/** Zones and tables of a branch, including hidden ones, for the table editor. */
export const seatingQuery = (branchId: string) =>
  queryOptions({
    queryKey: ['tables', branchId, 'all'],
    queryFn: async () => {
      const [zones, tables] = await Promise.all([
        supabase
          .from('zones')
          .select('id, name, sort_order, is_active')
          .eq('branch_id', branchId)
          .order('sort_order'),
        supabase
          .from('dining_tables')
          .select('id, name, zone_id, sort_order, is_active, zones(name, sort_order)')
          .eq('branch_id', branchId)
          .order('sort_order'),
      ])
      return { zones: unwrap<Zone[]>(zones), tables: unwrap<DiningTable[]>(tables) }
    },
  })

export async function saveZone(zone: {
  id?: string
  branch_id: string
  name: string
  sort_order: number
  is_active: boolean
}) {
  const { id, ...fields } = zone
  unwrap(
    await (id ? supabase.from('zones').update(fields).eq('id', id) : supabase.from('zones').insert(fields)),
  )
}

export async function saveTable(table: {
  id?: string
  branch_id: string
  zone_id: string | null
  name: string
  sort_order: number
  is_active: boolean
}) {
  const { id, ...fields } = table
  unwrap(
    await (id
      ? supabase.from('dining_tables').update(fields).eq('id', id)
      : supabase.from('dining_tables').insert(fields)),
  )
}

export const customersQuery = queryOptions({
  queryKey: ['customers'],
  queryFn: async () =>
    unwrap<Customer[]>(
      await supabase.from('customers').select('id, name, phone, address').eq('is_active', true).order('name'),
    ),
})

// ---------------------------------------------------------------------------
// Cash sessions
// ---------------------------------------------------------------------------
export const openSessionQuery = (branchId: string) =>
  queryOptions({
    queryKey: salesKeys.openSession(branchId),
    queryFn: async () =>
      unwrap<CashSession | null>(
        await supabase
          .from('cash_sessions')
          .select(SESSION_COLUMNS)
          .eq('branch_id', branchId)
          .eq('status', 'open')
          .maybeSingle(),
      ),
  })

export const sessionSummaryQuery = (sessionId: string) =>
  queryOptions({
    queryKey: salesKeys.summary(sessionId),
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap<CashSummary>(await supabase.rpc('cash_session_summary', { p_session_id: sessionId })),
  })

export const sessionMovementsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: salesKeys.movements(sessionId),
    queryFn: async () =>
      unwrap<CashMovement[]>(
        await supabase
          .from('cash_movements')
          .select('id, kind, amount, reason, created_at')
          .eq('cash_session_id', sessionId)
          .order('created_at', { ascending: false }),
      ),
  })

export const closedSessionsQuery = (branchId: string) =>
  queryOptions({
    queryKey: salesKeys.sessions(branchId),
    queryFn: async () =>
      unwrap<CashSession[]>(
        await supabase
          .from('cash_sessions')
          .select(SESSION_COLUMNS)
          .eq('branch_id', branchId)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false })
          .limit(20),
      ),
  })

export async function openCashSession(branchId: string, openingAmount: number): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('open_cash_session', { p_branch_id: branchId, p_opening_amount: openingAmount }),
  )
}

export async function addCashMovement(input: {
  sessionId: string
  kind: 'in' | 'out'
  amount: number
  reason: string
}): Promise<void> {
  unwrap(
    await supabase.rpc('add_cash_movement', {
      p_session_id: input.sessionId,
      p_kind: input.kind,
      p_amount: input.amount,
      p_reason: input.reason,
    }),
  )
}

export async function closeCashSession(input: {
  sessionId: string
  countedCash: number
  notes: string
}): Promise<CashSummary> {
  return unwrap<CashSummary>(
    await supabase.rpc('close_cash_session', {
      p_session_id: input.sessionId,
      p_counted_cash: input.countedCash,
      p_notes: input.notes,
    }),
  )
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const openOrdersQuery = (branchId: string) =>
  queryOptions({
    queryKey: salesKeys.openOrders(branchId),
    // Realtime refreshes this instantly; polling is only a safety net.
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap<Order[]>(
        await supabase
          .from('orders')
          .select(ORDER_SELECT)
          .eq('branch_id', branchId)
          .eq('status', 'open')
          .order('created_at'),
      ),
  })

export const recentOrdersQuery = (sessionId: string) =>
  queryOptions({
    queryKey: salesKeys.recentOrders(sessionId),
    queryFn: async () =>
      unwrap<Order[]>(
        await supabase
          .from('orders')
          .select(ORDER_SELECT)
          .eq('cash_session_id', sessionId)
          .order('paid_at', { ascending: false, nullsFirst: false })
          .limit(30),
      ),
  })

export async function fetchOrder(orderId: string): Promise<Order> {
  return unwrap<Order>(await supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).single())
}

export interface NewOrderItem {
  variant_id: string
  quantity: number
  add_on_ids: string[]
  notes: string
}

export interface NewOrder {
  branch_id: string
  order_type: OrderType
  table_id?: string
  park_note?: string
  customer_id?: string
  delivery_address?: string
  delivery_fee?: number
  courier_name?: string
  items: NewOrderItem[]
}

export async function createOrder(order: NewOrder): Promise<string> {
  return unwrap<string>(await supabase.rpc('create_order', { payload: order }))
}

export async function addOrderItems(orderId: string, items: NewOrderItem[]): Promise<void> {
  unwrap(await supabase.rpc('add_order_items', { p_order_id: orderId, p_items: items }))
}

export async function voidOrderItem(itemId: string, reason: string): Promise<void> {
  unwrap(await supabase.rpc('void_order_item', { p_item_id: itemId, p_reason: reason }))
}

export async function cancelOrder(orderId: string, reason: string): Promise<void> {
  unwrap(await supabase.rpc('cancel_order', { p_order_id: orderId, p_reason: reason }))
}

export interface PaymentInput {
  method_code: string
  amount: number
  cash_received?: number
  customer_id?: string
}

export interface PayOrderInput {
  discount_amount: number
  discount_reason: string
  tip_amount: number
  payments: PaymentInput[]
}

export async function payOrder(orderId: string, input: PayOrderInput): Promise<void> {
  unwrap(await supabase.rpc('pay_order', { p_order_id: orderId, payload: input }))
}

export async function saveCustomer(input: {
  id?: string
  name: string
  phone: string
  address: string
}): Promise<string> {
  return unwrap<string>(await supabase.rpc('save_customer', { payload: input }))
}

export async function moveOrderTable(orderId: string, tableId: string): Promise<void> {
  unwrap(await supabase.rpc('move_order_table', { p_order_id: orderId, p_table_id: tableId }))
}

// ---------------------------------------------------------------------------
// Preparation screen
// ---------------------------------------------------------------------------
export const kitchenQuery = (branchId: string) =>
  queryOptions({
    queryKey: salesKeys.kitchen(branchId),
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap<KitchenItem[]>(
        await supabase
          .from('order_items')
          .select(
            `id, order_id, product_name, variant_name, quantity, add_ons, notes, prep_status, created_at,
             orders!inner(order_number, order_type, park_note, status, created_at, dining_tables(name), customers(name))`,
          )
          .eq('branch_id', branchId)
          .eq('requires_preparation', true)
          .is('voided_at', null)
          .in('prep_status', ['pending', 'preparing', 'ready'])
          .neq('orders.status', 'cancelled')
          // Anything older than a day was surely delivered and just not marked.
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
          .order('created_at'),
      ),
  })

export async function setPrepStatus(itemIds: string[], status: PrepStatus): Promise<number> {
  return unwrap<number>(await supabase.rpc('set_prep_status', { p_item_ids: itemIds, p_status: status }))
}
