import { queryOptions } from '@tanstack/react-query'
import type { SupplyUnit } from '@/features/catalog/types'
import { supabase } from '@/lib/supabase'

/** All inventory queries start with 'inventory' so one invalidation refreshes them. */
export const inventoryKeys = {
  all: ['inventory'] as const,
  stock: (branchId: string) => ['inventory', 'stock', branchId] as const,
  movements: (branchId: string) => ['inventory', 'movements', branchId] as const,
  transfers: (branchId: string) => ['inventory', 'transfers', branchId] as const,
  purchases: (branchId: string) => ['inventory', 'purchases', branchId] as const,
  suppliers: ['inventory', 'suppliers'] as const,
  balances: ['inventory', 'supplier-balances'] as const,
}

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export interface StockRow {
  supply_id: string
  name: string
  unit: SupplyUnit
  unit_cost: number
  quantity: number
  min_quantity: number
  /** Threshold set for this branch (null = uses the supply default). */
  branch_min: number | null
}

interface SupplyWithStock {
  id: string
  name: string
  unit: SupplyUnit
  unit_cost: number
  default_min_quantity: number
  supply_stock: { quantity: number; min_quantity: number | null }[]
}

/** Every active supply with its stock in the branch (0 when it never had movements). */
export const stockQuery = (branchId: string) =>
  queryOptions({
    queryKey: inventoryKeys.stock(branchId),
    queryFn: async (): Promise<StockRow[]> => {
      const rows = unwrap<SupplyWithStock[]>(
        await supabase
          .from('supplies')
          .select('id, name, unit, unit_cost, default_min_quantity, supply_stock(quantity, min_quantity)')
          .eq('is_active', true)
          .eq('supply_stock.branch_id', branchId)
          .order('name'),
      )
      return rows.map((s) => {
        const stock = s.supply_stock[0]
        return {
          supply_id: s.id,
          name: s.name,
          unit: s.unit,
          unit_cost: s.unit_cost,
          quantity: stock?.quantity ?? 0,
          min_quantity: stock?.min_quantity ?? s.default_min_quantity,
          branch_min: stock?.min_quantity ?? null,
        }
      })
    },
  })

export type MovementType =
  'purchase' | 'sale' | 'sale_reversal' | 'waste' | 'adjustment' | 'transfer_out' | 'transfer_in'

export interface Movement {
  id: number
  movement_type: MovementType
  quantity: number
  unit_cost: number | null
  reason: string | null
  created_at: string
  supplies: { name: string; unit: SupplyUnit }
  profiles: { full_name: string } | null
}

export const movementsQuery = (branchId: string, supplyId: string | null) =>
  queryOptions({
    queryKey: [...inventoryKeys.movements(branchId), supplyId],
    queryFn: async () => {
      let query = supabase
        .from('stock_movements')
        .select(
          'id, movement_type, quantity, unit_cost, reason, created_at, supplies(name, unit), profiles(full_name)',
        )
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(150)
      if (supplyId) query = query.eq('supply_id', supplyId)
      return unwrap<Movement[]>(await query)
    },
  })

export async function recordWaste(input: {
  branchId: string
  supplyId: string
  quantity: number
  reason: string
}): Promise<void> {
  unwrap(
    await supabase.rpc('record_waste', {
      p_branch_id: input.branchId,
      p_supply_id: input.supplyId,
      p_quantity: input.quantity,
      p_reason: input.reason,
    }),
  )
}

export async function setMinStock(branchId: string, supplyId: string, minQuantity: number | null) {
  unwrap(
    await supabase.rpc('set_min_stock', {
      p_branch_id: branchId,
      p_supply_id: supplyId,
      p_min_quantity: minQuantity,
    }),
  )
}

export async function applyInventoryCount(
  branchId: string,
  items: { supply_id: string; counted_quantity: number }[],
  notes: string,
): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('apply_inventory_count', { p_branch_id: branchId, p_items: items, p_notes: notes }),
  )
}

export interface CountResultItem {
  supply_id: string
  expected_quantity: number
  counted_quantity: number
  difference: number
  supplies: { name: string; unit: SupplyUnit; unit_cost: number }
}

export async function fetchCountResult(countId: string): Promise<CountResultItem[]> {
  return unwrap<CountResultItem[]>(
    await supabase
      .from('inventory_count_items')
      .select('supply_id, expected_quantity, counted_quantity, difference, supplies(name, unit, unit_cost)')
      .eq('count_id', countId)
      .neq('difference', 0),
  )
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------
export interface BranchOption {
  id: string
  name: string
  is_main: boolean
}

/** Every active branch (staff of one branch still need to know where to send). */
export const branchesQuery = queryOptions({
  queryKey: ['branches'],
  staleTime: 60 * 60_000,
  queryFn: async () =>
    unwrap<BranchOption[]>(
      await supabase
        .from('branches')
        .select('id, name, is_main')
        .eq('is_active', true)
        .order('is_main', { ascending: false }),
    ),
})
export type TransferStatus = 'sent' | 'received' | 'received_with_issues' | 'cancelled'

export interface Transfer {
  id: string
  from_branch_id: string
  to_branch_id: string
  status: TransferStatus
  notes: string | null
  sent_at: string
  received_at: string | null
  receive_notes: string | null
  from_branch: { name: string }
  to_branch: { name: string }
  sender: { full_name: string } | null
  receiver: { full_name: string } | null
  transfer_items: {
    supply_id: string
    quantity_sent: number
    quantity_received: number | null
    supplies: { name: string; unit: SupplyUnit }
  }[]
}

export const transfersQuery = (branchId: string) =>
  queryOptions({
    queryKey: inventoryKeys.transfers(branchId),
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap<Transfer[]>(
        await supabase
          .from('transfers')
          .select(
            `id, from_branch_id, to_branch_id, status, notes, sent_at, received_at, receive_notes,
             from_branch:branches!transfers_from_branch_id_fkey(name),
             to_branch:branches!transfers_to_branch_id_fkey(name),
             sender:profiles!transfers_sent_by_fkey(full_name),
             receiver:profiles!transfers_received_by_fkey(full_name),
             transfer_items(supply_id, quantity_sent, quantity_received, supplies(name, unit))`,
          )
          .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
          .order('sent_at', { ascending: false })
          .limit(40),
      ),
  })

export interface QuantityLine {
  supply_id: string
  quantity: number
}

export async function createTransfer(input: {
  from_branch_id: string
  to_branch_id: string
  notes: string
  items: QuantityLine[]
}): Promise<string> {
  return unwrap<string>(await supabase.rpc('create_transfer', { payload: input }))
}

export async function receiveTransfer(
  transferId: string,
  items: { supply_id: string; quantity_received: number }[],
  notes: string,
): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('receive_transfer', { p_transfer_id: transferId, p_items: items, p_notes: notes }),
  )
}

export async function cancelTransfer(transferId: string, reason: string): Promise<void> {
  unwrap(await supabase.rpc('cancel_transfer', { p_transfer_id: transferId, p_reason: reason }))
}

// ---------------------------------------------------------------------------
// Purchases and suppliers
// ---------------------------------------------------------------------------
export interface Supplier {
  id: string
  name: string
  phone: string | null
  notes: string | null
}

export const suppliersQuery = queryOptions({
  queryKey: inventoryKeys.suppliers,
  queryFn: async () =>
    unwrap<Supplier[]>(
      await supabase.from('suppliers').select('id, name, phone, notes').eq('is_active', true).order('name'),
    ),
})

export interface SupplierBalance {
  supplier_id: string
  name: string
  purchased: number
  paid: number
  balance: number
}

/** Managers only (RLS): what is owed to each supplier. */
export const supplierBalancesQuery = queryOptions({
  queryKey: inventoryKeys.balances,
  queryFn: async () =>
    unwrap<SupplierBalance[]>(
      await supabase.from('supplier_balances').select('*').order('balance', { ascending: false }),
    ),
})

export interface Purchase {
  id: string
  total: number
  notes: string | null
  receipt_key: string | null
  created_at: string
  suppliers: { name: string } | null
  profiles: { full_name: string } | null
  purchase_items: { quantity: number; line_total: number; supplies: { name: string; unit: SupplyUnit } }[]
}

export const purchasesQuery = (branchId: string) =>
  queryOptions({
    queryKey: inventoryKeys.purchases(branchId),
    queryFn: async () =>
      unwrap<Purchase[]>(
        await supabase
          .from('purchases')
          .select(
            `id, total, notes, receipt_key, created_at, suppliers(name), profiles(full_name),
             purchase_items(quantity, line_total, supplies(name, unit))`,
          )
          .eq('branch_id', branchId)
          .order('created_at', { ascending: false })
          .limit(40),
      ),
  })

export type PurchasePaymentKind = 'cash_drawer' | 'other' | 'credit'

export interface PurchaseInput {
  branch_id: string
  supplier_id: string | null
  notes: string
  receipt_key: string | null
  items: { supply_id: string; quantity: number; line_total: number }[]
  send: { to_branch_id: string; items: QuantityLine[] } | null
  payment: { kind: PurchasePaymentKind; method_code?: string }
}

export async function recordPurchase({ send, ...input }: PurchaseInput): Promise<string> {
  const payload = send && send.items.length > 0 ? { ...input, send } : input
  return unwrap<string>(await supabase.rpc('record_purchase', { payload }))
}

export async function saveSupplier(input: { id?: string; name: string; phone: string; notes?: string }) {
  return unwrap<string>(await supabase.rpc('save_supplier', { payload: input }))
}

export async function paySupplier(input: {
  supplierId: string
  amount: number
  methodCode: string
  fromCashDrawer: boolean
  notes: string
}): Promise<void> {
  unwrap(
    await supabase.rpc('pay_supplier', {
      p_supplier_id: input.supplierId,
      p_amount: input.amount,
      p_method_code: input.methodCode,
      p_from_cash_drawer: input.fromCashDrawer,
      p_notes: input.notes,
    }),
  )
}
