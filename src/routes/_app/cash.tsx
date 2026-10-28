import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Printer, TriangleAlert, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardsSkeleton } from '@/components/ui/skeleton'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { recordExpense } from '@/features/expenses/expenses-api'
import { useExpenseMutation } from '@/features/expenses/use-expense-mutation'
import { printTicket } from '@/features/printing/print-store'
import { CashClosingTicket } from '@/features/printing/tickets'
import { CashMovementDialog, CloseSessionDialog } from '@/features/sales/components/cash-dialogs'
import { OpenSessionCard } from '@/features/sales/components/open-session-card'
import {
  addCashMovement,
  closeCashSession,
  closedSessionsQuery,
  openSessionQuery,
  sessionMovementsQuery,
  sessionSummaryQuery,
} from '@/features/sales/sales-api'
import type { CashSession, CashSummary } from '@/features/sales/types'
import { useSalesMutation } from '@/features/sales/use-sales-mutation'
import { formatCurrency, formatDateTime, formatTime } from '@/lib/format'
import { uploadMedia } from '@/lib/media'

export const Route = createFileRoute('/_app/cash')({
  beforeLoad: requireModule('cash'),
  component: CashScreen,
})

function CashScreen() {
  const { activeBranch } = useStaff()
  if (!activeBranch) return null
  return <BranchCash key={activeBranch.id} branchId={activeBranch.id} branchName={activeBranch.name} />
}

interface ClosedResult {
  session: CashSession
  summary: CashSummary
}

function BranchCash({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { profile } = useStaff()
  const isManager = profile.role === 'owner' || profile.role === 'admin'
  const { data: session, isPending } = useQuery(openSessionQuery(branchId))
  const [closed, setClosed] = useState<ClosedResult | null>(null)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Wallet className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Turno de caja</h1>
          <p className="text-fg-muted">{branchName}</p>
        </div>
      </header>

      {closed ? (
        <CloseResult
          result={closed}
          branchName={branchName}
          staffName={profile.full_name}
          onDone={() => setClosed(null)}
        />
      ) : isPending ? (
        <CardsSkeleton />
      ) : session ? (
        <OpenSession
          session={session}
          isManager={isManager}
          onClosed={(summary) =>
            setClosed({ session: { ...session, closed_at: new Date().toISOString() }, summary })
          }
        />
      ) : (
        <OpenSessionCard branchId={branchId} branchName={branchName} />
      )}

      <SessionHistory branchId={branchId} isManager={isManager} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </div>
  )
}

function OpenSession({
  session,
  isManager,
  onClosed,
}: {
  session: CashSession
  isManager: boolean
  onClosed: (summary: CashSummary) => void
}) {
  const { data: summary } = useSuspenseQuery(sessionSummaryQuery(session.id))
  const { data: movements } = useSuspenseQuery(sessionMovementsQuery(session.id))
  const [movementKind, setMovementKind] = useState<'in' | 'out' | null>(null)
  const [closing, setClosing] = useState(false)

  const movement = useSalesMutation(addCashMovement, 'Movimiento registrado')
  // A cash out that paid a business expense is recorded as an expense paid
  // from the drawer: the database creates the cash movement in the same step.
  const expense = useExpenseMutation(
    async (input: { amount: number; reason: string; categoryId: string; receipt: Blob | null }) =>
      recordExpense({
        branch_id: session.branch_id,
        category_id: input.categoryId,
        amount: input.amount,
        description: input.reason,
        receipt_key: input.receipt ? await uploadMedia(input.receipt, 'receipts') : null,
        from_drawer: true,
      }),
    'Gasto registrado',
  )
  const close = useSalesMutation(closeCashSession)

  return (
    <section className="flex flex-col gap-6" aria-label="Turno abierto">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-5">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <span className="size-2.5 rounded-full bg-success" aria-hidden />
            Turno abierto desde {formatTime(session.opened_at)}
          </p>
          <p className="text-sm text-fg-muted">Base de caja {formatCurrency(session.opening_amount)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMovementKind('in')}>
            <ArrowDownLeft className="size-4" aria-hidden />
            Entrada
          </Button>
          <Button variant="secondary" onClick={() => setMovementKind('out')}>
            <ArrowUpRight className="size-4" aria-hidden />
            Salida
          </Button>
          <Button onClick={() => setClosing(true)}>Cerrar turno</Button>
        </div>
      </div>

      {summary.open_orders > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          Hay {summary.open_orders} pedido(s) sin cobrar. Hay que cobrarlos o anularlos antes de cerrar.
          <Link to="/pos" className="ml-auto underline">
            Ir a la caja
          </Link>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Ventas del turno"
          value={formatCurrency(summary.net_sales)}
          hint="Sin propinas ni domicilios"
        />
        <Stat label="Pedidos cobrados" value={summary.paid_orders} />
        <Stat label="Fiado en el turno" value={formatCurrency(summary.credit_sales)} />
        {isManager ? (
          <Stat
            label="Efectivo esperado"
            value={formatCurrency(summary.expected_cash)}
            hint="Solo lo ven dueño y admin"
          />
        ) : (
          <Stat label="Pedidos anulados" value={summary.cancelled_orders} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 font-semibold">Por método de pago</h2>
          {summary.by_method.length === 0 ? (
            <p className="text-sm text-fg-subtle">Aún no hay ventas en este turno.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {summary.by_method.map((m) => (
                <li key={m.method_code} className="flex justify-between py-2.5">
                  <span>
                    {m.name}{' '}
                    <span className="text-sm text-fg-subtle">
                      · {m.orders} {m.orders === 1 ? 'pedido' : 'pedidos'}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatCurrency(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 font-semibold">Entradas y salidas de efectivo</h2>
          {movements.length === 0 ? (
            <p className="text-sm text-fg-subtle">Sin movimientos.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">{m.reason}</span>
                    <span className="text-xs text-fg-subtle">{formatTime(m.created_at)}</span>
                  </span>
                  <span
                    className={m.kind === 'in' ? 'text-success tabular-nums' : 'text-danger tabular-nums'}
                  >
                    {m.kind === 'in' ? '+' : '−'} {formatCurrency(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CashMovementDialog
        key={movementKind ?? 'closed'}
        open={movementKind !== null}
        kind={movementKind ?? 'in'}
        loading={movement.isPending || expense.isPending}
        onCancel={() => setMovementKind(null)}
        onConfirm={({ amount, reason, categoryId, receipt }) => {
          const done = { onSuccess: () => setMovementKind(null) }
          if (categoryId) {
            expense.mutate({ amount, reason, categoryId, receipt }, done)
          } else {
            movement.mutate({ sessionId: session.id, kind: movementKind ?? 'in', amount, reason }, done)
          }
        }}
      />
      <CloseSessionDialog
        open={closing}
        loading={close.isPending}
        onCancel={() => setClosing(false)}
        onConfirm={({ countedCash, notes }) =>
          close.mutate(
            { sessionId: session.id, countedCash, notes },
            {
              onSuccess: (result) => {
                setClosing(false)
                onClosed(result)
              },
            },
          )
        }
      />
    </section>
  )
}

function CloseResult({
  result,
  branchName,
  staffName,
  onDone,
}: {
  result: ClosedResult
  branchName: string
  staffName: string
  onDone: () => void
}) {
  const difference = result.summary.difference ?? 0
  const balanced = difference === 0
  const tone = balanced ? 'text-success' : difference < 0 ? 'text-danger' : 'text-warning'

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
      {balanced ? (
        <CheckCircle2 className="size-12 text-success" aria-hidden />
      ) : (
        <TriangleAlert className="size-12 text-warning" aria-hidden />
      )}
      <h2 className="text-xl font-semibold">Turno cerrado</h2>
      <p className="text-fg-muted">
        Contado: <b className="text-fg">{formatCurrency(result.summary.counted_cash ?? 0)}</b> · Esperado:{' '}
        <b className="text-fg">{formatCurrency(result.summary.expected_cash)}</b>
      </p>
      <p className={`text-lg font-semibold ${tone}`}>
        {balanced
          ? 'La caja cuadra perfecto'
          : `${difference < 0 ? 'Faltan' : 'Sobran'} ${formatCurrency(Math.abs(difference))}`}
      </p>
      <p className="text-sm text-fg-subtle">El resumen se envió a los dueños.</p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            void printTicket(
              <CashClosingTicket
                session={result.session}
                summary={result.summary}
                branchName={branchName}
                staffName={staffName}
              />,
            )
          }
        >
          <Printer className="size-4" aria-hidden />
          Imprimir cierre
        </Button>
        <Button onClick={onDone}>Listo</Button>
      </div>
    </section>
  )
}

function SessionHistory({ branchId, isManager }: { branchId: string; isManager: boolean }) {
  const { data: sessions = [] } = useQuery(closedSessionsQuery(branchId))
  if (sessions.length === 0) return null

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <h2 id="history-title" className="font-semibold">
        Turnos anteriores
      </h2>
      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Cierre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Contado
              </th>
              {isManager && (
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  Esperado
                </th>
              )}
              {isManager && (
                <th scope="col" className="px-4 py-3 font-medium">
                  Diferencia
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const difference = s.difference ?? 0
              return (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatCurrency(s.counted_cash ?? 0)}</td>
                  {isManager && (
                    <td className="hidden px-4 py-3 tabular-nums sm:table-cell">
                      {formatCurrency(s.expected_cash ?? 0)}
                    </td>
                  )}
                  {isManager && (
                    <td className="px-4 py-3">
                      {difference === 0 ? (
                        <Badge tone="success">Cuadró</Badge>
                      ) : difference < 0 ? (
                        <Badge tone="danger">Faltó {formatCurrency(Math.abs(difference))}</Badge>
                      ) : (
                        <Badge tone="warning">Sobró {formatCurrency(difference)}</Badge>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
