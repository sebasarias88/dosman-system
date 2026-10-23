import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Settings2, ShoppingBag } from 'lucide-react'
import { useMemo, useReducer, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { catalogQuery } from '@/features/catalog/catalog-api'
import type { Catalog, Product } from '@/features/catalog/types'
import { usePrintSettings } from '@/features/printing/print-host'
import { printTicket, setPrintSettings } from '@/features/printing/print-store'
import { KitchenTicket, ReceiptTicket } from '@/features/printing/tickets'
import { OpenSessionCard } from '@/features/sales/components/open-session-card'
import { cartCount, cartReducer, cartTotal, toOrderItems, type CartLine } from '@/features/sales/pos/cart'
import { ItemPicker } from '@/features/sales/pos/item-picker'
import { OpenOrdersList, OrderDetailSheet, RecentOrders } from '@/features/sales/pos/open-orders'
import { draftProblem, EMPTY_DRAFT, OrderPanel, type OrderDraft } from '@/features/sales/pos/order-panel'
import { PaymentDialog } from '@/features/sales/pos/payment-dialog'
import { ProductGrid } from '@/features/sales/pos/product-grid'
import {
  addOrderItems,
  createOrder,
  fetchOrder,
  openOrdersQuery,
  openSessionQuery,
  paymentMethodsQuery,
  recentOrdersQuery,
  salesKeys,
  tablesQuery,
  type NewOrder,
} from '@/features/sales/sales-api'
import type { Order, OrderItem } from '@/features/sales/types'
import { useSalesMutation } from '@/features/sales/use-sales-mutation'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { Branch } from '@/types/app'

export const Route = createFileRoute('/_app/pos')({
  beforeLoad: requireModule('pos'),
  staticData: { compactShell: true },
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: PosScreen,
})

function PosScreen() {
  const { activeBranch } = useStaff()
  const { data: session, isPending } = useQuery({
    ...openSessionQuery(activeBranch?.id ?? ''),
    enabled: !!activeBranch,
  })

  if (!activeBranch) return null
  if (isPending) return <Spinner className="m-10" />
  if (!session) {
    return (
      <div className="h-full overflow-y-auto p-6 lg:p-10">
        <OpenSessionCard branchId={activeBranch.id} branchName={activeBranch.name} />
      </div>
    )
  }
  return <Pos key={activeBranch.id} branch={activeBranch} sessionId={session.id} />
}

type View = 'new' | 'open' | 'recent'

/** Turns cart lines into ticket items, keeping only what goes to preparation. */
function kitchenItemsFromCart(lines: CartLine[], prepByVariant: Map<string, boolean>): OrderItem[] {
  return lines
    .filter((l) => prepByVariant.get(l.variantId) ?? true)
    .map((l) => ({
      id: l.key,
      variant_id: l.variantId,
      product_name: l.productName,
      variant_name: l.variantName,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      add_ons: l.addOns,
      line_total: l.unitPrice * l.quantity,
      notes: l.notes || null,
      created_at: new Date().toISOString(),
      voided_at: null,
      void_reason: null,
    }))
}

function Pos({ branch, sessionId }: { branch: Branch; sessionId: string }) {
  const { profile } = useStaff()
  const queryClient = useQueryClient()
  const { data: catalog } = useQuery(catalogQuery)
  const { data: tables = [] } = useQuery(tablesQuery(branch.id))
  const { data: openOrders = [] } = useQuery(openOrdersQuery(branch.id))
  const { data: methods = [] } = useQuery(paymentMethodsQuery)
  const printSettings = usePrintSettings()

  const [view, setView] = useState<View>('new')
  const [lines, dispatch] = useReducer(cartReducer, [])
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_DRAFT)
  const [addingTo, setAddingTo] = useState<Order | null>(null)
  const [picking, setPicking] = useState<Product | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [paying, setPaying] = useState<Order | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const prepByVariant = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const product of catalog?.products ?? []) {
      for (const variant of product.product_variants) map.set(variant.id, product.requires_preparation)
    }
    return map
  }, [catalog])

  const occupiedTableIds = useMemo(
    () => new Set(openOrders.map((o) => o.table_id).filter((id): id is string => Boolean(id))),
    [openOrders],
  )
  const detailOrder = openOrders.find((o) => o.id === detailId) ?? null

  function resetCart() {
    dispatch({ type: 'clear' })
    setDraft(EMPTY_DRAFT)
    setAddingTo(null)
    setCartOpen(false)
  }

  function printKitchen(
    order: Pick<
      Order,
      'order_number' | 'order_type' | 'dining_tables' | 'park_note' | 'customers' | 'created_at'
    >,
    items: OrderItem[],
    isAddition = false,
  ) {
    if (!printSettings.autoKitchen || items.length === 0) return
    void printTicket(
      <KitchenTicket order={order} items={items} branchName={branch.name} isAddition={isAddition} />,
    )
  }

  function printReceipt(order: Order) {
    void printTicket(
      <ReceiptTicket
        order={order}
        branchName={branch.name}
        staffName={profile.full_name}
        methods={methods}
        kind="receipt"
      />,
    )
  }

  const submit = useSalesMutation(async ({ payNow }: { payNow: boolean }) => {
    const items = toOrderItems(lines)
    const kitchenItems = kitchenItemsFromCart(lines, prepByVariant)

    if (addingTo) {
      await addOrderItems(addingTo.id, items)
      printKitchen(addingTo, kitchenItems, true)
      return { order: await fetchOrder(addingTo.id), payNow: false }
    }

    const payload: NewOrder = { branch_id: branch.id, order_type: draft.type, items }
    if (draft.type === 'table') payload.table_id = draft.tableId
    if (draft.type === 'park') payload.park_note = draft.parkNote.trim()
    if (draft.type === 'delivery' && draft.customer) {
      payload.customer_id = draft.customer.id
      payload.delivery_address = draft.deliveryAddress.trim() || draft.customer.address || ''
      payload.delivery_fee = draft.deliveryFee ?? 0
      payload.courier_name = draft.courierName.trim()
    }
    const order = await fetchOrder(await createOrder(payload))
    printKitchen(
      order,
      order.order_items.filter((i) => prepByVariant.get(i.variant_id) ?? true),
    )
    return { order, payNow }
  })

  function handleSubmit(payNow: boolean) {
    if (!addingTo && draftProblem(draft, lines)) return
    submit.mutate(
      { payNow },
      {
        onSuccess: ({ order, payNow: shouldPay }) => {
          resetCart()
          if (shouldPay) setPaying(order)
          else
            toast.success(
              addingTo
                ? `Agregado al pedido #${order.order_number}`
                : `Pedido #${order.order_number} enviado`,
            )
        },
      },
    )
  }

  function handlePaid(order: Order) {
    setPaying(null)
    setDetailId(null)
    if (printSettings.autoReceipt) printReceipt(order)
    void queryClient.invalidateQueries({ queryKey: salesKeys.all })
  }

  if (!catalog) return <Spinner className="m-10" />

  const count = cartCount(lines)
  const panel = (
    <OrderPanel
      branch={branch}
      tables={tables}
      occupiedTableIds={occupiedTableIds}
      draft={draft}
      onDraftChange={setDraft}
      lines={lines}
      dispatch={dispatch}
      addingTo={addingTo}
      onCancelAdding={() => {
        setAddingTo(null)
        dispatch({ type: 'clear' })
      }}
      busy={submit.isPending}
      onSubmit={handleSubmit}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4" aria-label="Caja">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="Vista">
            {(
              [
                ['new', 'Nuevo pedido'],
                ['open', `Abiertos (${openOrders.length})`],
                ['recent', 'Cobrados'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={cn(
                  'h-10 rounded-lg px-4 text-sm font-medium transition-colors',
                  view === id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <p className="hidden text-sm text-fg-muted sm:block">{branch.name}</p>
          <Button variant="ghost" size="icon" aria-label="Impresión" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-5" aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {view === 'new' && <ProductGrid catalog={catalog} onPick={(product) => pick(product, catalog)} />}
          {view === 'open' && (
            <OpenOrdersList orders={openOrders} onSelect={(order) => setDetailId(order.id)} />
          )}
          {view === 'recent' && <RecentList sessionId={sessionId} onReprint={printReceipt} />}
        </div>
      </section>

      <aside
        className="hidden w-[23rem] shrink-0 border-l border-line bg-surface lg:block"
        aria-label="Pedido actual"
      >
        {panel}
      </aside>

      {/* Phones and tablets: summary bar that opens the order. */}
      {view === 'new' && (
        <div className="fixed inset-x-3 bottom-3 z-20 lg:hidden">
          <Button size="lg" className="w-full justify-between shadow-2xl" onClick={() => setCartOpen(true)}>
            <span className="flex items-center gap-2">
              <ShoppingBag className="size-5" aria-hidden />
              {addingTo ? `Agregar a #${addingTo.order_number}` : 'Ver pedido'} ({count})
            </span>
            <span className="tabular-nums">{formatCurrency(cartTotal(lines))}</span>
          </Button>
        </div>
      )}
      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title="Pedido actual">
        <div className="-m-5 h-[calc(100dvh-5rem)]">{panel}</div>
      </Sheet>

      {picking && (
        <ItemPicker
          key={`pick-${picking.id}`}
          product={picking}
          addOns={catalog.addOns}
          onClose={() => setPicking(null)}
          onAdd={(line) => {
            dispatch({ type: 'add', line })
            setPicking(null)
          }}
        />
      )}

      {detailOrder && (
        <OrderDetailSheet
          key={`detail-${detailOrder.id}`}
          order={detailOrder}
          branchName={branch.name}
          staffName={profile.full_name}
          canManage={profile.role !== 'waiter'}
          onClose={() => setDetailId(null)}
          onAddItems={(order) => {
            dispatch({ type: 'clear' })
            setAddingTo(order)
            setDetailId(null)
            setView('new')
          }}
          onPay={(order) => setPaying(order)}
        />
      )}

      {paying && (
        <PaymentDialog
          key={`pay-${paying.id}`}
          order={paying}
          onPaid={handlePaid}
          onClose={() => setPaying(null)}
        />
      )}

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Impresión en este equipo">
        <div className="flex flex-col gap-3">
          <Switch
            label="Imprimir recibo al cobrar"
            checked={printSettings.autoReceipt}
            onCheckedChange={(autoReceipt) => setPrintSettings({ autoReceipt })}
          />
          <Switch
            label="Imprimir comanda al enviar pedido"
            description="Solo los productos que van a preparación"
            checked={printSettings.autoKitchen}
            onCheckedChange={(autoKitchen) => setPrintSettings({ autoKitchen })}
          />
          <p className="text-sm text-fg-subtle">
            Para imprimir sin que aparezca la ventana de impresión, abre el sistema con el acceso directo de
            Chrome configurado en modo de impresión silenciosa.
          </p>
        </div>
      </Sheet>
    </div>
  )

  function pick(product: Product, currentCatalog: Catalog) {
    const variants = product.product_variants.filter((v) => v.is_active)
    const hasAddOns = currentCatalog.addOns.some(
      (a) => a.is_active && product.product_add_ons.some((l) => l.add_on_id === a.id),
    )
    const only = variants[0]
    // One size and nothing to choose: add it straight away.
    if (variants.length === 1 && only && !hasAddOns) {
      dispatch({
        type: 'add',
        line: {
          variantId: only.id,
          productName: product.name,
          variantName: only.name,
          unitPrice: only.price,
          addOns: [],
          quantity: 1,
          notes: '',
        },
      })
      return
    }
    setPicking(product)
  }
}

function RecentList({ sessionId, onReprint }: { sessionId: string; onReprint: (order: Order) => void }) {
  const { data: orders = [] } = useQuery(recentOrdersQuery(sessionId))
  return <RecentOrders orders={orders} onReprint={onReprint} />
}
