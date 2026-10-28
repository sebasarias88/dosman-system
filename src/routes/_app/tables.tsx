import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRightLeft, Bell, CheckCheck, Pencil, Plus, Trees } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { TilesSkeleton } from '@/components/ui/skeleton'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { OpenSessionCard } from '@/features/sales/components/open-session-card'
import { OrderDetailSheet, useNow } from '@/features/sales/pos/open-orders'
import { PaymentDialog } from '@/features/sales/pos/payment-dialog'
import {
  moveOrderTable,
  openOrdersQuery,
  openSessionQuery,
  setPrepStatus,
  tablesQuery,
} from '@/features/sales/sales-api'
import { TablesEditor } from '@/features/sales/tables/tables-editor'
import type { DiningTable, Order } from '@/features/sales/types'
import { useSalesMutation } from '@/features/sales/use-sales-mutation'
import { cn } from '@/lib/cn'
import { formatCurrency, formatElapsed } from '@/lib/format'
import type { Branch } from '@/types/app'

export const Route = createFileRoute('/_app/tables')({
  beforeLoad: requireModule('tables'),
  staticData: { compactShell: true },
  component: TablesScreen,
})

function TablesScreen() {
  const { activeBranch, profile } = useStaff()
  const { data: session, isPending } = useQuery({
    ...openSessionQuery(activeBranch?.id ?? ''),
    enabled: !!activeBranch,
  })

  if (!activeBranch) return null
  if (isPending) return <TilesSkeleton className="p-4" />
  if (!session) {
    return (
      <div className="h-full overflow-y-auto p-6 lg:p-10">
        <OpenSessionCard
          branchId={activeBranch.id}
          branchName={activeBranch.name}
          canOpen={profile.role !== 'waiter'}
        />
      </div>
    )
  }
  return <TablesMap key={activeBranch.id} branch={activeBranch} />
}

type TableState = 'free' | 'busy' | 'ready'

function readyItemIds(order: Order): string[] {
  return order.order_items
    .filter((i) => !i.voided_at && i.requires_preparation && i.prep_status === 'ready')
    .map((i) => i.id)
}

function TablesMap({ branch }: { branch: Branch }) {
  const { profile } = useStaff()
  const navigate = useNavigate()
  const now = useNow()
  const { data: tables = [], isPending } = useQuery(tablesQuery(branch.id))
  const { data: openOrders = [] } = useQuery(openOrdersQuery(branch.id))
  const [detailId, setDetailId] = useState<string | null>(null)
  const [paying, setPaying] = useState<Order | null>(null)
  const [editing, setEditing] = useState(false)

  const isManager = profile.role === 'owner' || profile.role === 'admin'
  const canCharge = profile.role !== 'waiter'

  const orderByTable = useMemo(() => {
    const map = new Map<string, Order>()
    for (const order of openOrders) if (order.table_id) map.set(order.table_id, order)
    return map
  }, [openOrders])
  const parkOrders = openOrders.filter((o) => o.order_type === 'park')
  const detailOrder = openOrders.find((o) => o.id === detailId) ?? null

  // Tables grouped by zone, in the zone's order.
  const zones = useMemo(() => {
    const groups = new Map<string, { name: string; order: number; tables: DiningTable[] }>()
    for (const table of tables) {
      const key = table.zone_id ?? 'none'
      const group = groups.get(key) ?? {
        name: table.zones?.name ?? 'Sin zona',
        order: table.zones?.sort_order ?? 999,
        tables: [],
      }
      group.tables.push(table)
      groups.set(key, group)
    }
    return [...groups.entries()].sort((a, b) => a[1].order - b[1].order)
  }, [tables])

  const free = tables.length - orderByTable.size

  if (isPending) return <TilesSkeleton className="p-4" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Mesas</h1>
            <p className="text-fg-muted">
              {branch.name} · {free} libres de {tables.length}
            </p>
          </div>
          <Legend />
          {isManager && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Editar mesas
            </Button>
          )}
        </header>

        {tables.length === 0 && (
          <p className="rounded-card border border-dashed border-line-strong p-8 text-center text-fg-muted">
            {isManager
              ? 'Aún no hay mesas. Créalas con “Editar mesas”.'
              : 'Aún no hay mesas configuradas en esta sede.'}
          </p>
        )}

        {zones.map(([zoneKey, zone]) => (
          <section key={zoneKey} aria-labelledby={`zone-${zoneKey}`} className="flex flex-col gap-3">
            <h2
              id={`zone-${zoneKey}`}
              className="text-xs font-medium tracking-[0.14em] text-fg-subtle uppercase"
            >
              {zone.name}
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {zone.tables.map((table) => {
                const order = orderByTable.get(table.id)
                const state: TableState = !order ? 'free' : readyItemIds(order).length > 0 ? 'ready' : 'busy'
                return (
                  <li key={table.id}>
                    <TableTile
                      name={table.name}
                      state={state}
                      order={order}
                      now={now}
                      onClick={() =>
                        order
                          ? setDetailId(order.id)
                          : void navigate({ to: '/pos', search: { table: table.id } })
                      }
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <section aria-labelledby="park-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="park-heading" className="text-xs font-medium tracking-[0.14em] text-fg-subtle uppercase">
              Parque
            </h2>
            <Button
              variant="secondary"
              onClick={() => void navigate({ to: '/pos', search: { type: 'park' } })}
            >
              <Plus className="size-4" aria-hidden />
              Pedido de parque
            </Button>
          </div>
          {parkOrders.length === 0 ? (
            <p className="text-sm text-fg-subtle">No hay pedidos en el parque.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parkOrders.map((order) => (
                <li key={order.id}>
                  <TableTile
                    name={order.park_note ?? 'Parque'}
                    state={readyItemIds(order).length > 0 ? 'ready' : 'busy'}
                    order={order}
                    now={now}
                    icon
                    onClick={() => setDetailId(order.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detailOrder && (
        <OrderDetailSheet
          key={`detail-${detailOrder.id}`}
          order={detailOrder}
          branchName={branch.name}
          staffName={profile.full_name}
          canManage={canCharge}
          onClose={() => setDetailId(null)}
          onAddItems={(order) => void navigate({ to: '/pos', search: { add: order.id } })}
          onPay={(order) => setPaying(order)}
          extraActions={<TableActions order={detailOrder} tables={tables} occupied={orderByTable} />}
        />
      )}

      {paying && (
        <PaymentDialog
          key={`pay-${paying.id}`}
          order={paying}
          onPaid={() => {
            setPaying(null)
            setDetailId(null)
          }}
          onClose={() => setPaying(null)}
        />
      )}

      {editing && <TablesEditor branchId={branch.id} onClose={() => setEditing(false)} />}
    </div>
  )
}

const STATE_STYLES: Record<TableState, string> = {
  free: 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
  busy: 'border-warning/40 bg-warning-soft hover:border-warning/70',
  ready: 'border-success/60 bg-success-soft hover:border-success',
}

function TableTile({
  name,
  state,
  order,
  now,
  icon = false,
  onClick,
}: {
  name: string
  state: TableState
  order: Order | undefined
  now: number
  icon?: boolean
  onClick: () => void
}) {
  const items = order?.order_items.filter((i) => !i.voided_at) ?? []
  const minutes = order ? (now - new Date(order.created_at).getTime()) / 60_000 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${name}: ${state === 'free' ? 'libre' : state === 'ready' ? 'pedido listo para entregar' : 'ocupada'}`}
      className={cn(
        'flex min-h-28 w-full flex-col justify-between gap-2 rounded-card border p-4 text-left transition-colors',
        STATE_STYLES[state],
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-lg leading-tight font-semibold">
          {icon && <Trees className="size-4 shrink-0 text-fg-muted" aria-hidden />}
          <span className="truncate">{name}</span>
        </span>
        {state === 'ready' && (
          <Badge tone="success">
            <Bell className="mr-1 size-3" aria-hidden />
            Listo
          </Badge>
        )}
      </span>
      {order ? (
        <span className="flex items-end justify-between gap-2 text-sm">
          <span
            className={cn('text-fg-muted', minutes > 30 ? 'text-danger' : minutes > 15 ? 'text-warning' : '')}
            title={`${items.reduce((n, i) => n + i.quantity, 0)} productos`}
          >
            #{order.order_number} · {formatElapsed(order.created_at, now)}
          </span>
          <span className="font-semibold tabular-nums">{formatCurrency(order.total)}</span>
        </span>
      ) : (
        <span className="text-sm text-fg-subtle">Libre · tocar para pedir</span>
      )}
    </button>
  )
}

function Legend() {
  return (
    <ul className="hidden items-center gap-4 text-xs text-fg-muted md:flex" aria-label="Colores">
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-full border border-line-strong bg-surface" /> Libre
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-full bg-warning" /> Ocupada
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-full bg-success" /> Listo para entregar
      </li>
    </ul>
  )
}

/** Deliver what the kitchen finished and move the order to another table. */
function TableActions({
  order,
  tables,
  occupied,
}: {
  order: Order
  tables: DiningTable[]
  occupied: Map<string, Order>
}) {
  const [target, setTarget] = useState('')
  const ready = readyItemIds(order)
  const deliver = useSalesMutation((ids: string[]) => setPrepStatus(ids, 'served'), 'Marcado como entregado')
  const move = useSalesMutation(
    (tableId: string) => moveOrderTable(order.id, tableId),
    'Pedido cambiado de mesa',
  )
  const freeTables = tables.filter((t) => !occupied.has(t.id))

  return (
    <div className="flex flex-col gap-3">
      {ready.length > 0 && (
        <Button size="lg" onClick={() => deliver.mutate(ready)} loading={deliver.isPending}>
          <CheckCheck className="size-5" aria-hidden />
          Entregar lo que está listo ({ready.length})
        </Button>
      )}
      {order.order_type === 'table' && freeTables.length > 0 && (
        <div className="flex gap-2">
          <Select
            aria-label="Mover a la mesa"
            placeholder="Mover a otra mesa…"
            value={target}
            onValueChange={setTarget}
            options={freeTables.map((t) => ({
              value: t.id,
              label: `${t.name}${t.zones ? ` · ${t.zones.name}` : ''}`,
            }))}
          />
          <Button
            variant="secondary"
            disabled={!target}
            loading={move.isPending}
            onClick={() => move.mutate(target, { onSuccess: () => setTarget('') })}
          >
            <ArrowRightLeft className="size-4" aria-hidden />
            Mover
          </Button>
        </div>
      )}
    </div>
  )
}
