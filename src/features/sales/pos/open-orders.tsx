import { useQuery } from '@tanstack/react-query'
import { Ban, ChefHat, Plus, Printer, Receipt, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReasonDialog } from '@/components/ui/reason-dialog'
import { Sheet } from '@/components/ui/sheet'
import { printTicket } from '@/features/printing/print-store'
import { KitchenTicket, ReceiptTicket } from '@/features/printing/tickets'
import { cn } from '@/lib/cn'
import { formatCurrency, formatElapsed, formatTime } from '@/lib/format'
import { cancelOrder, paymentMethodsQuery, voidOrderItem } from '../sales-api'
import { describeOrder, type Order } from '../types'
import { useSalesMutation } from '../use-sales-mutation'

/** Re-renders every 30 s so waiting times stay current. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function OpenOrdersList({ orders, onSelect }: { orders: Order[]; onSelect: (order: Order) => void }) {
  const now = useNow()
  if (orders.length === 0) {
    return <p className="p-10 text-center text-fg-muted">No hay pedidos abiertos.</p>
  }
  return (
    <ul className="grid gap-2.5 overflow-y-auto pb-4 sm:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => {
        const minutes = (now - new Date(order.created_at).getTime()) / 60_000
        const items = order.order_items.filter((i) => !i.voided_at)
        return (
          <li key={order.id}>
            <button
              type="button"
              onClick={() => onSelect(order)}
              className="flex w-full flex-col gap-2 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold">#{order.order_number}</span>
                <Badge tone={minutes > 30 ? 'danger' : minutes > 15 ? 'warning' : 'neutral'}>
                  {formatElapsed(order.created_at, now)}
                </Badge>
              </span>
              <span className="truncate text-fg-muted">{describeOrder(order)}</span>
              <span className="flex items-center justify-between text-sm">
                <span className="text-fg-subtle">{items.reduce((n, i) => n + i.quantity, 0)} productos</span>
                <span className="font-medium tabular-nums">{formatCurrency(order.total)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

interface OrderDetailProps {
  order: Order
  branchName: string
  staffName: string
  canManage: boolean
  onAddItems: (order: Order) => void
  onPay: (order: Order) => void
  onClose: () => void
}

/** Everything that can be done with an open order. */
export function OrderDetailSheet({
  order,
  branchName,
  staffName,
  canManage,
  onAddItems,
  onPay,
  onClose,
}: OrderDetailProps) {
  const { data: methods = [] } = useQuery(paymentMethodsQuery)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const voidItem = useSalesMutation(
    ({ itemId, reason }: { itemId: string; reason: string }) => voidOrderItem(itemId, reason),
    'Producto anulado',
  )
  const cancel = useSalesMutation((reason: string) => cancelOrder(order.id, reason), 'Pedido anulado')

  const active = order.order_items.filter((i) => !i.voided_at)
  const voided = order.order_items.filter((i) => i.voided_at)

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Pedido #${order.order_number}`}
      description={`${describeOrder(order)} · desde ${formatTime(order.created_at)}`}
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-fg-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{formatCurrency(order.total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => onAddItems(order)}>
              <Plus className="size-4" aria-hidden />
              Agregar
            </Button>
            {canManage && (
              <Button size="lg" onClick={() => onPay(order)} disabled={active.length === 0}>
                Cobrar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {order.order_type === 'delivery' && order.customers && (
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <p className="font-medium">{order.customers.name}</p>
            {order.customers.phone && <p className="text-fg-muted">{order.customers.phone}</p>}
            <p className="text-fg-muted">{order.delivery_address}</p>
            {order.courier_name && <p className="text-fg-muted">Domiciliario: {order.courier_name}</p>}
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {active.map((item) => (
            <li key={item.id} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {item.quantity}× {item.product_name}
                  {item.variant_name !== 'Único' && (
                    <span className="text-fg-muted"> · {item.variant_name}</span>
                  )}
                </p>
                {item.add_ons.length > 0 && (
                  <p className="text-sm text-fg-muted">+ {item.add_ons.map((a) => a.name).join(', ')}</p>
                )}
                {item.notes && <p className="text-sm text-warning">» {item.notes}</p>}
              </div>
              <span className="tabular-nums">{formatCurrency(item.line_total)}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Anular ${item.product_name}`}
                  onClick={() => setVoiding(item.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {voided.length > 0 && (
          <div>
            <p className="mb-2 text-sm text-fg-subtle">Anulados</p>
            <ul className="flex flex-col gap-1 text-sm text-fg-subtle">
              {voided.map((item) => (
                <li key={item.id} className="line-through">
                  {item.quantity}× {item.product_name} · {item.void_reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {order.delivery_fee > 0 && (
          <p className="flex justify-between text-sm text-fg-muted">
            <span>Domicilio</span>
            <span className="tabular-nums">{formatCurrency(order.delivery_fee)}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              void printTicket(<KitchenTicket order={order} items={active} branchName={branchName} />)
            }
          >
            <ChefHat className="size-4" aria-hidden />
            Comanda
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void printTicket(
                <ReceiptTicket
                  order={order}
                  branchName={branchName}
                  staffName={staffName}
                  methods={methods}
                  kind="bill"
                />,
              )
            }
          >
            <Receipt className="size-4" aria-hidden />
            Cuenta
          </Button>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            className={cn('self-start text-danger')}
            onClick={() => setCancelling(true)}
          >
            <Ban className="size-4" aria-hidden />
            Anular pedido completo
          </Button>
        )}
      </div>

      <ReasonDialog
        open={voiding !== null}
        title="Anular producto"
        description="El inventario se devuelve y el dueño recibe un aviso."
        confirmLabel="Anular producto"
        suggestions={['Error al digitar', 'Cliente cambió de opinión', 'Producto dañado']}
        loading={voidItem.isPending}
        onCancel={() => setVoiding(null)}
        onConfirm={(reason) =>
          voiding && voidItem.mutate({ itemId: voiding, reason }, { onSuccess: () => setVoiding(null) })
        }
      />
      <ReasonDialog
        open={cancelling}
        title={`Anular pedido #${order.order_number}`}
        description="Se anulan todos los productos, el inventario se devuelve y el dueño recibe un aviso."
        confirmLabel="Anular pedido"
        suggestions={['Cliente se fue', 'Pedido duplicado', 'Error al digitar']}
        loading={cancel.isPending}
        onCancel={() => setCancelling(false)}
        onConfirm={(reason) =>
          cancel.mutate(reason, {
            onSuccess: () => {
              setCancelling(false)
              onClose()
            },
          })
        }
      />
    </Sheet>
  )
}

export function RecentOrders({ orders, onReprint }: { orders: Order[]; onReprint: (order: Order) => void }) {
  if (orders.length === 0) {
    return <p className="p-10 text-center text-fg-muted">Aún no hay pedidos cobrados en este turno.</p>
  }
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto pb-4">
      {orders.map((order) => (
        <li
          key={order.id}
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 pl-4"
        >
          <span className="w-14 font-semibold">#{order.order_number}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{describeOrder(order)}</span>
            <span className="text-sm text-fg-subtle">
              {formatTime(order.paid_at ?? order.created_at)}
              {order.status === 'cancelled' && ' · Anulado'}
            </span>
          </span>
          <span className={cn('tabular-nums', order.status === 'cancelled' && 'text-fg-subtle line-through')}>
            {formatCurrency(order.total)}
          </span>
          {order.status === 'paid' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Reimprimir recibo #${order.order_number}`}
              onClick={() => onReprint(order)}
            >
              <Printer className="size-4" aria-hidden />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
