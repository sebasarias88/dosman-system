import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Under 'customers' so the sales mutations (which create debts) refresh them too. */
export const customerKeys = {
  debts: ['customers', 'debts'] as const,
  ledger: (id: string) => ['customers', 'ledger', id] as const,
}

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export interface CustomerDebt {
  customer_id: string
  name: string
  phone: string | null
  address: string | null
  is_active: boolean
  credit_total: number
  paid_total: number
  balance: number
  /** Oldest credit sale that is still unpaid (payments cancel the oldest first). */
  oldest_unpaid_at: string | null
  last_payment_at: string | null
}

export const debtsQuery = queryOptions({
  queryKey: customerKeys.debts,
  queryFn: async () =>
    unwrap<CustomerDebt[]>(await supabase.rpc('customer_debts')).map((row) => ({
      ...row,
      credit_total: Number(row.credit_total),
      paid_total: Number(row.paid_total),
      balance: Number(row.balance),
    })),
})

export type LedgerEntry =
  | {
      kind: 'credit'
      id: string
      at: string
      amount: number
      orderNumber: number
      businessDate: string
      orderId: string
    }
  | {
      kind: 'payment'
      id: string
      at: string
      amount: number
      method: string
      notes: string | null
      by: string | null
    }

interface CreditRow {
  id: string
  amount: number
  created_at: string
  orders: { id: string; order_number: number; business_date: string }
}

interface PaymentRow {
  id: string
  amount: number
  created_at: string
  notes: string | null
  payment_methods: { name: string }
  profiles: { full_name: string } | null
}

/** Credit sales and payments back, newest first, with the balance after each one. */
export const ledgerQuery = (customerId: string) =>
  queryOptions({
    queryKey: customerKeys.ledger(customerId),
    queryFn: async () => {
      const [credits, payments] = await Promise.all([
        supabase
          .from('payments')
          .select(
            'id, amount, created_at, orders!inner(id, order_number, business_date, status), payment_methods!inner(kind)',
          )
          .eq('customer_id', customerId)
          .eq('payment_methods.kind', 'credit')
          .eq('orders.status', 'paid'),
        supabase
          .from('customer_payments')
          .select('id, amount, created_at, notes, payment_methods(name), profiles(full_name)')
          .eq('customer_id', customerId),
      ])
      const entries: LedgerEntry[] = [
        ...unwrap<CreditRow[]>(credits).map((c): LedgerEntry => ({
          kind: 'credit',
          id: c.id,
          at: c.created_at,
          amount: Number(c.amount),
          orderNumber: c.orders.order_number,
          businessDate: c.orders.business_date,
          orderId: c.orders.id,
        })),
        ...unwrap<PaymentRow[]>(payments).map((p): LedgerEntry => ({
          kind: 'payment',
          id: p.id,
          at: p.created_at,
          amount: Number(p.amount),
          method: p.payment_methods.name,
          notes: p.notes,
          by: p.profiles?.full_name ?? null,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))

      let balance = 0
      const withBalance = entries.map((entry) => {
        balance += entry.kind === 'credit' ? entry.amount : -entry.amount
        return { ...entry, balance }
      })
      return withBalance.reverse()
    },
  })

export interface CustomerPaymentResult {
  id: string
  balance_before: number
  balance_after: number
}

export async function recordCustomerPayment(input: {
  customer_id: string
  branch_id: string
  amount: number
  method_code: string
  notes: string
}): Promise<CustomerPaymentResult> {
  const result = unwrap<CustomerPaymentResult>(
    await supabase.rpc('record_customer_payment', { payload: input }),
  )
  return {
    ...result,
    balance_before: Number(result.balance_before),
    balance_after: Number(result.balance_after),
  }
}

export async function setCustomerActive(input: { id: string; active: boolean }): Promise<void> {
  unwrap(await supabase.rpc('set_customer_active', { p_customer_id: input.id, p_active: input.active }))
}

/** wa.me link with a polite reminder. Colombian mobiles get the 57 prefix. */
export function whatsappReminder(phone: string, name: string, balance: string): string | null {
  const digits = phone.replace(/\D/g, '')
  const number = digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits
  if (number.length < 10) return null
  const firstName = name.trim().split(/\s+/)[0] ?? name
  const text = `Hola ${firstName}, te saluda Dosman Cholao & Coffee. Te recordamos que tienes un saldo pendiente de ${balance}. ¡Gracias por tu compra!`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
