import { useQuery } from '@tanstack/react-query'
import { Ban, Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { ReasonDialog } from '@/components/ui/reason-dialog'
import { Spinner } from '@/components/ui/spinner'
import { useStaff } from '@/features/auth/use-staff'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { openPrivateMedia } from '@/lib/media'
import { currentMonth, expensesQuery, voidExpense, type Expense } from '../expenses-api'
import { useExpenseMutation } from '../use-expense-mutation'
import { ExpenseSheet, SHARED } from './expense-sheet'

const dayFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "2026-10-23" -> "vie, 23 oct" (dates without time, so read as UTC). */
function formatDay(date: string) {
  return dayFormatter.format(new Date(`${date}T00:00:00Z`))
}

export function ExpensesTab() {
  const { branches } = useStaff()
  const [month, setMonth] = useState(currentMonth())
  const [scope, setScope] = useState<string>('all')
  const [creating, setCreating] = useState(false)
  const [voiding, setVoiding] = useState<Expense | null>(null)
  const { data: expenses = [], isPending } = useQuery(expensesQuery(month))
  const voidMutation = useExpenseMutation(voidExpense, 'Gasto anulado')

  const visible = expenses.filter(
    (e) => scope === 'all' || (scope === SHARED ? e.branch_id === null : e.branch_id === scope),
  )
  const active = visible.filter((e) => !e.voided_at)
  const total = active.reduce((sum, e) => sum + e.amount, 0)
  const byCategory = [
    ...active
      .reduce(
        (map, e) => map.set(e.expense_categories.name, (map.get(e.expense_categories.name) ?? 0) + e.amount),
        new Map<string, number>(),
      )
      .entries(),
  ].sort((a, b) => b[1] - a[1])
  const top = byCategory[0]?.[1] ?? 0

  const scopes = [
    { id: 'all', label: 'Todo' },
    ...branches.map((b) => ({ id: b.id, label: b.name })),
    { id: SHARED, label: 'Compartidos' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-fg-muted">
          Mes
          <TextInput
            type="month"
            className="h-11 w-44"
            value={month}
            max={currentMonth()}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Sede" className="flex flex-wrap gap-1">
          {scopes.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={scope === s.id}
              onClick={() => setScope(s.id)}
              className={cn(
                'h-11 rounded-xl px-3.5 text-sm transition-colors',
                scope === s.id ? 'bg-fg text-ink' : 'bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          Nuevo gasto
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="text-sm text-fg-muted">Gastos del mes</p>
          <p className="text-3xl font-semibold tabular-nums">{formatCurrency(total)}</p>
          <p className="mt-1 text-sm text-fg-subtle">
            {active.length} {active.length === 1 ? 'gasto' : 'gastos'}
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 text-sm text-fg-muted">Por categoría</h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-fg-subtle">Sin gastos en este mes.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {byCategory.map(([name, value]) => (
                <li
                  key={name}
                  className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_auto]"
                >
                  <span className="truncate">{name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-fg-muted"
                      style={{ width: `${Math.max((value / top) * 100, 2)}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{formatCurrency(value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {isPending ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">No hay gastos registrados en este mes.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((expense) => (
            <li
              key={expense.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4',
                expense.voided_at && 'opacity-60',
              )}
            >
              <span className="w-24 shrink-0 text-sm text-fg-subtle">{formatDay(expense.expense_date)}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block font-medium', expense.voided_at && 'line-through')}>
                  {expense.description}
                </span>
                <span className="text-sm text-fg-subtle">
                  {expense.expense_categories.name} · {expense.branches?.name ?? 'Compartido'}
                  {expense.suppliers && ` · ${expense.suppliers.name}`}
                  {expense.creator && ` · ${expense.creator.full_name}`}
                </span>
                {expense.voided_at && (
                  <span className="block text-sm text-danger">
                    Anulado{expense.voider && ` por ${expense.voider.full_name}`}: {expense.void_reason}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                {expense.cash_session_id && <Badge>De la caja</Badge>}
                {expense.recurring_expense_id && <Badge>Fijo</Badge>}
                {expense.voided_at && <Badge tone="danger">Anulado</Badge>}
              </span>
              <span className="w-28 text-right font-semibold tabular-nums">
                {formatCurrency(expense.amount)}
              </span>
              <span className="flex gap-1">
                {expense.receipt_key && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ver recibo"
                    title="Ver recibo"
                    onClick={() =>
                      openPrivateMedia(expense.receipt_key ?? '').catch(() =>
                        toast.error('No se pudo abrir el recibo'),
                      )
                    }
                  >
                    <Receipt className="size-4" aria-hidden />
                  </Button>
                )}
                {!expense.voided_at && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Anular ${expense.description}`}
                    title="Anular"
                    onClick={() => setVoiding(expense)}
                  >
                    <Ban className="size-4" aria-hidden />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ExpenseSheet onClose={() => setCreating(false)} />}
      <ReasonDialog
        key={voiding?.id ?? 'none'}
        open={voiding !== null}
        title="Anular gasto"
        description={
          voiding?.cash_session_id
            ? 'Si el turno de caja sigue abierto, el dinero vuelve a la caja. Queda registrado quién lo anuló.'
            : 'El gasto deja de contar en los reportes. Queda registrado quién lo anuló.'
        }
        confirmLabel="Anular gasto"
        suggestions={['Se registró dos veces', 'Valor equivocado', 'No era un gasto']}
        loading={voidMutation.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={(reason) =>
          voiding && voidMutation.mutate({ id: voiding.id, reason }, { onSuccess: () => setVoiding(null) })
        }
      />
    </div>
  )
}
