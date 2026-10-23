import type { ReactNode } from 'react'
import { formatCurrency, formatDateTime } from '@/lib/format'
import {
  describeOrder,
  type CashSession,
  type CashSummary,
  type Order,
  type OrderItem,
  type PaymentMethod,
} from '@/features/sales/types'

/*
 * 80 mm tickets. They print black on white whatever the screen theme is,
 * so they use their own plain styles (see `.ticket` in styles/index.css).
 */

function Header({ branchName, title }: { branchName: string; title: string }) {
  return (
    <header className="ticket-center">
      <img src="/brand/logo-horizontal-black.svg" alt="" className="ticket-logo" />
      <p className="ticket-muted">{branchName}</p>
      <p className="ticket-title">{title}</p>
    </header>
  )
}

function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? 'ticket-row ticket-strong' : 'ticket-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

const Divider = () => <hr className="ticket-divider" />

function ItemLines({ items, withPrices }: { items: OrderItem[]; withPrices: boolean }) {
  return (
    <div className="ticket-items">
      {items.map((item) => (
        <div key={item.id} className="ticket-item">
          <div className="ticket-row">
            <span>
              <b>{item.quantity}×</b> {item.product_name}
              {item.variant_name !== 'Único' && ` (${item.variant_name})`}
            </span>
            {withPrices && <span>{formatCurrency(item.line_total)}</span>}
          </div>
          {item.add_ons.map((addOn) => (
            <div key={addOn.id} className="ticket-sub">
              + {addOn.name}
            </div>
          ))}
          {item.notes && <div className="ticket-note">» {item.notes}</div>}
        </div>
      ))}
    </div>
  )
}

interface ReceiptProps {
  order: Order
  branchName: string
  staffName: string
  methods: PaymentMethod[]
  /** 'bill' = account to show the customer before paying; 'receipt' = after paying. */
  kind: 'bill' | 'receipt'
}

export function ReceiptTicket({ order, branchName, staffName, methods, kind }: ReceiptProps) {
  const items = order.order_items.filter((i) => !i.voided_at)
  const methodName = (code: string) => methods.find((m) => m.code === code)?.name ?? code

  return (
    <article className="ticket">
      <Header branchName={branchName} title={kind === 'bill' ? 'CUENTA' : 'RECIBO'} />
      <Divider />
      <Row
        label={<b>Pedido #{order.order_number}</b>}
        value={formatDateTime(order.paid_at ?? order.created_at)}
      />
      <p>{describeOrder(order)}</p>
      {order.order_type === 'delivery' && (
        <>
          {order.customers?.phone && <p>Tel: {order.customers.phone}</p>}
          {order.delivery_address && <p>{order.delivery_address}</p>}
        </>
      )}
      <Divider />
      <ItemLines items={items} withPrices />
      <Divider />
      <Row label="Subtotal" value={formatCurrency(order.subtotal)} />
      {order.discount_amount > 0 && (
        <Row label="Descuento" value={`- ${formatCurrency(order.discount_amount)}`} />
      )}
      {order.delivery_fee > 0 && <Row label="Domicilio" value={formatCurrency(order.delivery_fee)} />}
      {order.tip_amount > 0 && <Row label="Propina" value={formatCurrency(order.tip_amount)} />}
      <Row label="TOTAL" value={formatCurrency(order.total)} strong />
      {kind === 'receipt' && order.payments.length > 0 && (
        <>
          <Divider />
          {order.payments.map((payment, index) => (
            <div key={index}>
              <Row label={methodName(payment.method_code)} value={formatCurrency(payment.amount)} />
              {payment.cash_received !== null && payment.cash_received > payment.amount && (
                <>
                  <Row label="  Recibido" value={formatCurrency(payment.cash_received)} />
                  <Row label="  Cambio" value={formatCurrency(payment.change_given ?? 0)} />
                </>
              )}
            </div>
          ))}
        </>
      )}
      <Divider />
      <p className="ticket-muted">Atendió: {staffName}</p>
      <p className="ticket-center ticket-footer">
        {kind === 'bill' ? 'Pendiente por pagar' : '¡Gracias por tu compra!'}
        <br />
        Documento interno · no es factura electrónica
      </p>
    </article>
  )
}

interface KitchenProps {
  order: Pick<
    Order,
    'order_number' | 'order_type' | 'dining_tables' | 'park_note' | 'customers' | 'created_at'
  >
  items: OrderItem[]
  branchName: string
  /** True when these items are added to an order that was already sent. */
  isAddition?: boolean
}

export function KitchenTicket({ order, items, branchName, isAddition = false }: KitchenProps) {
  return (
    <article className="ticket">
      <p className="ticket-center ticket-muted">{branchName} · COMANDA</p>
      <p className="ticket-center ticket-huge">#{order.order_number}</p>
      <p className="ticket-center ticket-title">{describeOrder(order)}</p>
      {isAddition && <p className="ticket-center ticket-strong">*** ADICIÓN AL PEDIDO ***</p>}
      <p className="ticket-center ticket-muted">{formatDateTime(new Date())}</p>
      <Divider />
      <div className="ticket-kitchen">
        <ItemLines items={items} withPrices={false} />
      </div>
    </article>
  )
}

interface ClosingProps {
  session: CashSession
  summary: CashSummary
  branchName: string
  staffName: string
}

export function CashClosingTicket({ session, summary, branchName, staffName }: ClosingProps) {
  const difference = summary.difference ?? session.difference ?? 0
  return (
    <article className="ticket">
      <Header branchName={branchName} title="CIERRE DE CAJA" />
      <Divider />
      <Row label="Abrió" value={formatDateTime(session.opened_at)} />
      <Row label="Cerró" value={formatDateTime(session.closed_at ?? new Date())} />
      <Row label="Cerrado por" value={staffName} />
      <Divider />
      <Row label="Base" value={formatCurrency(summary.opening_amount)} />
      {summary.by_method.map((m) => (
        <Row key={m.method_code} label={`${m.name} (${m.orders})`} value={formatCurrency(m.total)} />
      ))}
      {summary.customer_payments_total > 0 && (
        <Row label="Abonos de clientes" value={formatCurrency(summary.customer_payments_total)} />
      )}
      {summary.cash_in > 0 && <Row label="Entradas de efectivo" value={formatCurrency(summary.cash_in)} />}
      {summary.cash_out > 0 && (
        <Row label="Salidas de efectivo" value={`- ${formatCurrency(summary.cash_out)}`} />
      )}
      <Divider />
      <Row label="Efectivo esperado" value={formatCurrency(summary.expected_cash)} />
      <Row
        label="Efectivo contado"
        value={formatCurrency(summary.counted_cash ?? session.counted_cash ?? 0)}
      />
      <Row
        label={difference < 0 ? 'FALTANTE' : difference > 0 ? 'SOBRANTE' : 'DIFERENCIA'}
        value={formatCurrency(Math.abs(difference))}
        strong
      />
      <Divider />
      <Row label="Pedidos cobrados" value={summary.paid_orders} />
      <Row label="Ventas netas" value={formatCurrency(summary.net_sales)} />
      {summary.discounts > 0 && <Row label="Descuentos" value={formatCurrency(summary.discounts)} />}
      {summary.tips > 0 && <Row label="Propinas" value={formatCurrency(summary.tips)} />}
      <Row label="Pedidos anulados" value={summary.cancelled_orders} />
      <Row label="Productos anulados" value={summary.voided_items} />
      {session.close_notes && <p className="ticket-note">Nota: {session.close_notes}</p>}
      <p className="ticket-center ticket-footer">Documento interno</p>
    </article>
  )
}
