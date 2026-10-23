import { ORDER_TYPE_LABELS } from '@/features/sales/types'
import { formatCurrency } from '@/lib/format'
import { describeRange } from './periods'
import type { ProductRow, ReportOverview, ReportTotals } from './reports-api'

export interface ExportContext {
  overview: ReportOverview
  products: ProductRow[]
  from: string
  to: string
  scopeName: string
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function summaryRows(t: ReportTotals, p: ReportTotals): [string, number, number][] {
  return [
    ['Pedidos cobrados', t.orders, p.orders],
    ['Ventas (sin propinas ni domicilios)', t.sales, p.sales],
    ['Ticket promedio', t.average_ticket, p.average_ticket],
    ['Descuentos', t.discounts, p.discounts],
    ['Costo de lo vendido', t.cogs, p.cogs],
    ['Ganancia bruta', t.gross_profit, p.gross_profit],
    ['Mermas', t.waste_cost, p.waste_cost],
    ['Faltantes en conteos', t.adjustment_cost, p.adjustment_cost],
    ['Gastos', t.expenses, p.expenses],
    ['Ganancia real', t.net_profit, p.net_profit],
    ['Gastos compartidos (no incluidos por sede)', t.shared_expenses, p.shared_expenses],
    ['Propinas', t.tips, p.tips],
    ['Domicilios cobrados', t.delivery_fees, p.delivery_fees],
    ['Productos anulados (valor)', t.voided_value, p.voided_value],
    ['Productos anulados (cantidad)', t.voided_items, p.voided_items],
    ['Pedidos cancelados', t.cancelled_orders, p.cancelled_orders],
    ['Diferencias de caja', t.cash_difference, p.cash_difference],
  ]
}

const margin = (row: ProductRow) => (row.sales > 0 ? Math.round((row.profit / row.sales) * 1000) / 10 : null)

/** Excel with one sheet per section. The writer is loaded only when exporting. */
export async function exportReportXlsx(ctx: ExportContext): Promise<void> {
  const { downloadXlsx } = await import('@/lib/xlsx')
  const { overview: o } = ctx
  downloadXlsx(`Reporte ${ctx.scopeName} ${ctx.from} a ${ctx.to}`, [
    {
      name: 'Resumen',
      header: ['Concepto', `${ctx.from} a ${ctx.to}`, 'Periodo anterior'],
      rows: [['Sede', ctx.scopeName, ''], ...summaryRows(o.totals, o.previous)],
      widths: [44, 22, 22],
    },
    {
      name: 'Por día',
      header: ['Fecha', 'Pedidos', 'Ventas', 'Costo', 'Ganancia bruta', 'Gastos'],
      rows: o.daily.map((d) => [d.date, d.orders, d.sales, d.cogs, d.sales - d.cogs, d.expenses]),
    },
    {
      name: 'Productos',
      header: ['Producto', 'Tamaño', 'Categoría', 'Vendidos', 'Ventas', 'Costo', 'Ganancia', 'Margen %'],
      rows: ctx.products.map((r) => [
        r.product_name,
        r.variant_name,
        r.category_name ?? '',
        r.quantity,
        r.sales,
        r.cost,
        r.profit,
        margin(r),
      ]),
      widths: [30, 14, 18, 10, 14, 14, 14, 10],
    },
    {
      name: 'Medios de pago',
      header: ['Medio', 'Pedidos', 'Total'],
      rows: o.payment_methods.map((m) => [m.name, m.count, m.total]),
    },
    {
      name: 'Tipo de pedido',
      header: ['Tipo', 'Pedidos', 'Ventas'],
      rows: o.order_types.map((t) => [ORDER_TYPE_LABELS[t.type], t.orders, t.sales]),
    },
    {
      name: 'Gastos',
      header: ['Categoría', 'Total'],
      rows: o.expense_categories.map((c) => [c.name, c.total]),
    },
    {
      name: 'Horas',
      header: ['Día', 'Hora', 'Pedidos', 'Ventas'],
      rows: [...o.hours]
        .sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7) || a.hour - b.hour)
        .map((h) => [DAY_NAMES[h.dow], `${String(h.hour).padStart(2, '0')}:00`, h.orders, h.sales]),
    },
    ...(o.branches.length > 0
      ? [
          {
            name: 'Sedes',
            header: ['Concepto', ...o.branches.map((b) => b.name)],
            rows: summaryRows(o.totals, o.previous).map(([label], i) => [
              label,
              ...o.branches.map((b) => summaryRows(b, b)[i]?.[1] ?? null),
            ]),
            widths: [44, ...o.branches.map(() => 22)],
          },
        ]
      : []),
  ])
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Printable / PDF version on letter paper. It opens in its own window because
 * the app's print styles are set up for the 80 mm ticket printer.
 */
export function printReport(ctx: ExportContext): void {
  const { overview: o } = ctx
  const money = (v: number) => formatCurrency(v)
  const table = (head: string[], rows: (string | number)[][]) =>
    `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${typeof c === 'number' ? c : escapeHtml(c)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody></table>`

  const summary = summaryRows(o.totals, o.previous)
    .filter(([label]) => !label.includes('cantidad'))
    .map(([label, current, previous]) =>
      label === 'Pedidos cobrados' || label === 'Pedidos cancelados'
        ? [label, String(current), String(previous)]
        : [label, money(current), money(previous)],
    )

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte ${escapeHtml(ctx.scopeName)} · ${escapeHtml(describeRange(ctx.from, ctx.to))}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font: 11pt/1.4 system-ui, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2pt; } h2 { font-size: 12pt; margin: 18pt 0 6pt; }
  p.sub { color: #555; margin: 0 0 12pt; }
  .hero { display: flex; gap: 24pt; margin: 8pt 0 4pt; }
  .hero div { border: 1px solid #ccc; border-radius: 6pt; padding: 8pt 12pt; }
  .hero b { display: block; font-size: 15pt; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  th, td { text-align: left; padding: 3pt 4pt; border-bottom: 1px solid #ddd; }
  th { font-weight: 600; background: #f1f3f3; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
</style></head><body>
<h1>Dosman Cholao &amp; Coffee · Reporte</h1>
<p class="sub">${escapeHtml(ctx.scopeName)} · ${escapeHtml(describeRange(ctx.from, ctx.to))}</p>
<div class="hero">
  <div>Ventas<b>${money(o.totals.sales)}</b></div>
  <div>Ganancia bruta<b>${money(o.totals.gross_profit)}</b></div>
  <div>Ganancia real<b>${money(o.totals.net_profit)}</b></div>
</div>
<h2>Resumen</h2>${table(['Concepto', 'Periodo', 'Periodo anterior'], summary)}
${
  o.branches.length > 0
    ? `<h2>Sedes</h2>${table(
        ['Sede', 'Ventas', 'Pedidos', 'Ganancia bruta', 'Gastos', 'Ganancia real'],
        o.branches.map((b) => [
          b.name,
          money(b.sales),
          String(b.orders),
          money(b.gross_profit),
          money(b.expenses),
          money(b.net_profit),
        ]),
      )}`
    : ''
}
<h2>Productos</h2>${table(
    ['Producto', 'Vendidos', 'Ventas', 'Ganancia', 'Margen'],
    ctx.products.map((r) => [
      `${r.product_name}${r.variant_name !== 'Único' ? ` · ${r.variant_name}` : ''}`,
      String(r.quantity),
      money(r.sales),
      money(r.profit),
      margin(r) === null ? '—' : `${margin(r)} %`,
    ]),
  )}
<h2>Medios de pago</h2>${table(
    ['Medio', 'Pedidos', 'Total'],
    o.payment_methods.map((m) => [m.name, String(m.count), money(m.total)]),
  )}
<h2>Gastos por categoría</h2>${
    o.expense_categories.length
      ? table(
          ['Categoría', 'Total'],
          o.expense_categories.map((c) => [c.name, money(c.total)]),
        )
      : '<p>Sin gastos.</p>'
  }
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}
