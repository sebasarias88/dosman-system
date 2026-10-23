import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Every expense query starts with 'expenses' so one invalidation refreshes them. */
export const expenseKeys = {
  all: ['expenses'] as const,
  categories: ['expenses', 'categories'] as const,
  list: (month: string) => ['expenses', 'list', month] as const,
  recurring: ['expenses', 'recurring'] as const,
  generated: ['expenses', 'generated'] as const,
}

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

// ---------------------------------------------------------------------------
// Categories (staff read them for drawer expenses; managers edit them)
// ---------------------------------------------------------------------------
export interface ExpenseCategory {
  id: string
  name: string
  is_active: boolean
}

export const expenseCategoriesQuery = queryOptions({
  queryKey: expenseKeys.categories,
  staleTime: 10 * 60_000,
  queryFn: async () =>
    unwrap<ExpenseCategory[]>(
      await supabase.from('expense_categories').select('id, name, is_active').order('name'),
    ),
})

export async function saveExpenseCategory(input: { id?: string; name: string; is_active: boolean }) {
  const values = { name: input.name.trim(), is_active: input.is_active }
  if (input.id) {
    unwrap(await supabase.from('expense_categories').update(values).eq('id', input.id))
  } else {
    unwrap(await supabase.from('expense_categories').insert(values))
  }
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export interface Expense {
  id: string
  branch_id: string | null
  amount: number
  description: string
  expense_date: string
  receipt_key: string | null
  cash_session_id: string | null
  recurring_expense_id: string | null
  voided_at: string | null
  void_reason: string | null
  created_at: string
  expense_categories: { name: string }
  branches: { name: string } | null
  suppliers: { name: string } | null
  creator: { full_name: string } | null
  voider: { full_name: string } | null
}

/** "2026-10" -> first and last day of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year = 1970, m = 1] = month.split('-').map(Number)
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export const expensesQuery = (month: string) =>
  queryOptions({
    queryKey: expenseKeys.list(month),
    queryFn: async () => {
      const { from, to } = monthRange(month)
      return unwrap<Expense[]>(
        await supabase
          .from('expenses')
          .select(
            `id, branch_id, amount, description, expense_date, receipt_key, cash_session_id,
             recurring_expense_id, voided_at, void_reason, created_at,
             expense_categories(name), branches(name), suppliers(name),
             creator:profiles!expenses_created_by_fkey(full_name),
             voider:profiles!expenses_voided_by_fkey(full_name)`,
          )
          .gte('expense_date', from)
          .lte('expense_date', to)
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
      )
    },
  })

export interface ExpenseInput {
  branch_id: string | null
  category_id: string
  amount: number
  description: string
  expense_date?: string
  receipt_key?: string | null
  supplier_id?: string | null
  from_drawer: boolean
}

export async function recordExpense(input: ExpenseInput): Promise<string> {
  return unwrap<string>(await supabase.rpc('record_expense', { payload: input }))
}

export async function voidExpense(input: { id: string; reason: string }): Promise<void> {
  unwrap(await supabase.rpc('void_expense', { p_expense_id: input.id, p_reason: input.reason }))
}

// ---------------------------------------------------------------------------
// Recurring (fixed monthly) expenses
// ---------------------------------------------------------------------------
export interface RecurringExpense {
  id: string
  branch_id: string | null
  category_id: string
  name: string
  amount: number
  day_of_month: number
  is_active: boolean
  expense_categories: { name: string }
  branches: { name: string } | null
}

export const recurringQuery = queryOptions({
  queryKey: expenseKeys.recurring,
  queryFn: async () =>
    unwrap<RecurringExpense[]>(
      await supabase
        .from('recurring_expenses')
        .select(
          'id, branch_id, category_id, name, amount, day_of_month, is_active, expense_categories(name), branches(name)',
        )
        .order('is_active', { ascending: false })
        .order('day_of_month'),
    ),
})

export interface RecurringInput {
  id?: string
  branch_id: string | null
  category_id: string
  name: string
  amount: number
  day_of_month: number
  is_active: boolean
}

export async function saveRecurring(input: RecurringInput): Promise<string> {
  return unwrap<string>(await supabase.rpc('save_recurring_expense', { payload: input }))
}

export async function removeRecurring(id: string): Promise<'deleted' | 'archived'> {
  return unwrap<'deleted' | 'archived'>(await supabase.rpc('remove_recurring_expense', { p_id: id }))
}

/**
 * Creates this month's fixed expenses whose day has arrived. Idempotent: the
 * database creates each one once per month, so calling it on every visit is safe.
 */
export const generateRecurringQuery = queryOptions({
  queryKey: expenseKeys.generated,
  staleTime: 30 * 60_000,
  queryFn: async () => unwrap<number>(await supabase.rpc('generate_recurring_expenses')),
})

/** Current month in Colombia, "2026-10". */
export function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
}

/** Today in Colombia, "2026-10-23". */
export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}
