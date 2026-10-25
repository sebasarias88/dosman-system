import { queryOptions } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { supabase } from '@/lib/supabase'

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export const storageKeys = {
  usage: ['storage', 'usage'] as const,
  media: ['storage', 'media'] as const,
  history: ['storage', 'history'] as const,
}

export interface StorageUsage {
  database_bytes: number
  limit_bytes: number
  warning_percent: number
  tables: { name: string; bytes: number; rows: number }[]
  months: { month: string; orders: number }[]
  audit_rows: number
  oldest_order: string | null
  last_backup_at: string | null
  last_backup_until: string | null
  data_cleaned_before: string | null
  last_cleanup_at: string | null
}

export const usageQuery = queryOptions({
  queryKey: storageKeys.usage,
  queryFn: async () => unwrap<StorageUsage>(await supabase.rpc('storage_usage')),
})

export interface MediaUsage {
  products: { files: number; bytes: number }
  receipts: { files: number; bytes: number }
  limit_bytes: number
}

export const mediaUsageQuery = queryOptions({
  queryKey: storageKeys.media,
  retry: false,
  queryFn: () => apiJson<MediaUsage>('/api/storage/media'),
})

export interface MonthlyHistoryRow {
  month: string
  branch_name: string
  orders_count: number
  sales_total: number
  cost_total: number
  expenses_total: number
  cash_difference_total: number
}

export const monthlyHistoryQuery = queryOptions({
  queryKey: storageKeys.history,
  queryFn: async () =>
    unwrap<MonthlyHistoryRow[]>(await supabase.rpc('monthly_history')).map((r) => ({
      ...r,
      sales_total: Number(r.sales_total),
      cost_total: Number(r.cost_total),
      expenses_total: Number(r.expenses_total),
      cash_difference_total: Number(r.cash_difference_total),
    })),
})

/** Date before which sales detail was cleaned (readable by every staff member). */
export const cleanedBeforeQuery = queryOptions({
  queryKey: ['storage', 'cleaned-before'],
  staleTime: 10 * 60_000,
  queryFn: async () =>
    unwrap<{ data_cleaned_before: string | null }>(
      await supabase.from('app_settings').select('data_cleaned_before').single(),
    ).data_cleaned_before,
})

export async function recordBackup(until: string | null): Promise<void> {
  unwrap(await supabase.rpc('record_backup', { p_until: until }))
}

export interface CleanupResult {
  before: string
  orders: number
  order_items: number
  payments: number
  stock_movements: number
  audit_log: number
  notifications: number
}

export async function cleanupOldData(input: {
  before: string
  confirmation: string
}): Promise<CleanupResult> {
  return unwrap<CleanupResult>(
    await supabase.rpc('cleanup_old_data', { p_before: input.before, p_confirmation: input.confirmation }),
  )
}

/** "1,2 MB" */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: unit >= 2 ? 1 : 0 }).format(value)} ${units[unit]}`
}
