import { queryOptions } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { supabase } from '@/lib/supabase'

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export const settingsKeys = {
  branches: ['settings', 'branches'] as const,
  methods: ['settings', 'payment-methods'] as const,
  notifications: ['settings', 'notifications'] as const,
  status: ['settings', 'notification-status'] as const,
}

export interface BranchSettings {
  id: string
  name: string
  is_main: boolean
  uses_waiters: boolean
  takes_delivery: boolean
  /** "05:00:00" */
  day_cutoff: string
}

export const branchSettingsQuery = queryOptions({
  queryKey: settingsKeys.branches,
  queryFn: async () =>
    unwrap<BranchSettings[]>(
      await supabase
        .from('branches')
        .select('id, name, is_main, uses_waiters, takes_delivery, day_cutoff')
        .eq('is_active', true)
        .order('is_main', { ascending: false }),
    ),
})

export async function updateBranch(input: Omit<BranchSettings, 'is_main'>): Promise<void> {
  unwrap(
    await supabase.rpc('update_branch', { payload: { ...input, day_cutoff: input.day_cutoff.slice(0, 5) } }),
  )
}

export interface PaymentMethodSettings {
  code: string
  name: string
  kind: 'cash' | 'digital' | 'credit'
  sort_order: number
  is_active: boolean
}

export const methodSettingsQuery = queryOptions({
  queryKey: settingsKeys.methods,
  queryFn: async () =>
    unwrap<PaymentMethodSettings[]>(
      await supabase
        .from('payment_methods')
        .select('code, name, kind, sort_order, is_active')
        .order('sort_order'),
    ),
})

export async function savePaymentMethod(input: {
  code?: string
  name: string
  is_active: boolean
  sort_order: number
}): Promise<string> {
  return unwrap<string>(await supabase.rpc('save_payment_method', { payload: input }))
}

export interface NotificationSettings {
  telegram_chat_id: string | null
  telegram_chat_title: string | null
  notify_alerts: boolean
  notify_low_stock: boolean
  notify_cash_close: boolean
  notify_daily_summary: boolean
}

export const notificationSettingsQuery = queryOptions({
  queryKey: settingsKeys.notifications,
  queryFn: async () =>
    unwrap<NotificationSettings>(
      await supabase
        .from('app_settings')
        .select(
          'telegram_chat_id, telegram_chat_title, notify_alerts, notify_low_stock, notify_cash_close, notify_daily_summary',
        )
        .single(),
    ),
})

export async function updateNotificationSettings(input: Partial<NotificationSettings>): Promise<void> {
  unwrap(await supabase.rpc('update_notification_settings', { payload: input }))
}

export interface NotificationStatus {
  telegram: boolean
  server: boolean
  bot?: string
}

export const notificationStatusQuery = queryOptions({
  queryKey: settingsKeys.status,
  staleTime: 5 * 60_000,
  queryFn: () => apiJson<NotificationStatus>('/api/notifications/status'),
})

export interface TelegramChat {
  id: string
  title: string
  type: string
}

export async function findTelegramChats(): Promise<TelegramChat[]> {
  return (await apiJson<{ chats: TelegramChat[] }>('/api/notifications/chats', { method: 'POST', body: {} }))
    .chats
}

export async function sendTelegramTest(chatId: string): Promise<void> {
  await apiJson('/api/notifications/test', { method: 'POST', body: { chat_id: chatId } })
}
