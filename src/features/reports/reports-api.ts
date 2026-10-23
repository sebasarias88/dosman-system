import { queryOptions } from '@tanstack/react-query'
import type { OrderType } from '@/features/sales/types'
import { supabase } from '@/lib/supabase'

export interface ReportTotals {
  orders: number
  sales: number
  average_ticket: number
  discounts: number
  tips: number
  delivery_fees: number
  cogs: number
  gross_profit: number
  waste_cost: number
  adjustment_cost: number
  inventory_loss: number
  adjustment_surplus: number
  expenses: number
  shared_expenses: number
  net_profit: number
  cancelled_orders: number
  voided_items: number
  voided_value: number
  cash_difference: number
  short_closings: number
}

export interface ReportOverview {
  totals: ReportTotals
  previous: ReportTotals
  daily: { date: string; orders: number; sales: number; cogs: number; expenses: number }[]
  payment_methods: { code: string; name: string; kind: string; total: number; count: number }[]
  hours: { dow: number; hour: number; orders: number; sales: number }[]
  order_types: { type: OrderType; orders: number; sales: number }[]
  expense_categories: { name: string; total: number }[]
  branches: (ReportTotals & { id: string; name: string })[]
}

export interface ProductRow {
  variant_id: string
  product_name: string
  variant_name: string
  category_name: string | null
  quantity: number
  sales: number
  cost: number
  profit: number
}

export interface ReportFilters {
  /** null = both branches */
  branchId: string | null
  from: string
  to: string
}

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

/** Postgres numerics arrive as strings inside jsonb only when huge; normalize anyway. */
function numbers<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v,
  ) as T
}

export const overviewQuery = (f: ReportFilters) =>
  queryOptions({
    queryKey: ['reports', 'overview', f.branchId, f.from, f.to],
    staleTime: 60_000,
    queryFn: async () =>
      numbers(
        unwrap<ReportOverview>(
          await supabase.rpc('report_overview', { p_branch_id: f.branchId, p_from: f.from, p_to: f.to }),
        ),
      ),
  })

export const productsReportQuery = (f: ReportFilters) =>
  queryOptions({
    queryKey: ['reports', 'products', f.branchId, f.from, f.to],
    staleTime: 60_000,
    queryFn: async () =>
      unwrap<ProductRow[]>(
        await supabase.rpc('report_products', { p_branch_id: f.branchId, p_from: f.from, p_to: f.to }),
      ).map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        sales: Number(row.sales),
        cost: Number(row.cost),
        profit: Number(row.profit),
      })),
  })
