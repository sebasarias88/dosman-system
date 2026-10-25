import { supabase } from '@/lib/supabase'
import type { Cell, SheetData } from '@/lib/xlsx'

/*
 * Excel backup of the business data. Every table becomes a sheet with its raw
 * columns, so the file can be read in Excel today and, if ever needed,
 * loaded back into a database. Pages of 1000 rows keep each request light.
 */

interface TableSpec {
  table: string
  sheet: string
  /** Column used to limit a period backup ("everything before X"). */
  dateColumn?: string
  /** Stable order for pagination. */
  order: string
}

const TABLES: TableSpec[] = [
  { table: 'orders', sheet: 'Pedidos', dateColumn: 'business_date', order: 'id' },
  { table: 'order_items', sheet: 'Productos vendidos', dateColumn: 'created_at', order: 'id' },
  { table: 'payments', sheet: 'Pagos', dateColumn: 'created_at', order: 'id' },
  { table: 'cash_sessions', sheet: 'Turnos de caja', dateColumn: 'business_date', order: 'id' },
  { table: 'cash_movements', sheet: 'Entradas y salidas', dateColumn: 'created_at', order: 'id' },
  { table: 'customer_payments', sheet: 'Abonos', dateColumn: 'created_at', order: 'id' },
  { table: 'expenses', sheet: 'Gastos', dateColumn: 'expense_date', order: 'id' },
  { table: 'stock_movements', sheet: 'Movimientos inventario', dateColumn: 'created_at', order: 'id' },
  { table: 'purchases', sheet: 'Compras', dateColumn: 'created_at', order: 'id' },
  { table: 'purchase_items', sheet: 'Detalle compras', order: 'id' },
  { table: 'supplier_payments', sheet: 'Pagos a proveedores', dateColumn: 'created_at', order: 'id' },
  { table: 'transfers', sheet: 'Envíos', dateColumn: 'sent_at', order: 'id' },
  { table: 'transfer_items', sheet: 'Detalle envíos', order: 'id' },
  { table: 'inventory_counts', sheet: 'Conteos', dateColumn: 'created_at', order: 'id' },
  { table: 'inventory_count_items', sheet: 'Detalle conteos', order: 'id' },
  { table: 'audit_log', sheet: 'Actividad', dateColumn: 'created_at', order: 'id' },
  // Reference data: always complete.
  { table: 'customers', sheet: 'Clientes', order: 'id' },
  { table: 'suppliers', sheet: 'Proveedores', order: 'id' },
  { table: 'products', sheet: 'Productos', order: 'id' },
  { table: 'product_variants', sheet: 'Tamaños', order: 'id' },
  { table: 'add_ons', sheet: 'Adiciones', order: 'id' },
  { table: 'supplies', sheet: 'Insumos', order: 'id' },
  { table: 'recipe_items', sheet: 'Recetas', order: 'id' },
  { table: 'supply_stock', sheet: 'Existencias', order: 'supply_id' },
  { table: 'categories', sheet: 'Categorías', order: 'id' },
  { table: 'expense_categories', sheet: 'Categorías de gasto', order: 'id' },
  { table: 'recurring_expenses', sheet: 'Gastos fijos', order: 'id' },
  { table: 'payment_methods', sheet: 'Medios de pago', order: 'code' },
  { table: 'branches', sheet: 'Sedes', order: 'id' },
  { table: 'profiles', sheet: 'Empleados', order: 'id' },
  { table: 'monthly_summaries', sheet: 'Resúmenes mensuales', order: 'month' },
]

const PAGE = 1000

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'sí' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

async function fetchAll(spec: TableSpec, until: string | null): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(spec.table)
      .select('*')
      .order(spec.order)
      .range(from, from + PAGE - 1)
    if (until && spec.dateColumn) query = query.lt(spec.dateColumn, until)
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data as Record<string, unknown>[]))
    if (!data || data.length < PAGE) return rows
  }
}

/**
 * Builds and downloads the backup. `until` = only rows before that date
 * (the period about to be cleaned); null = everything.
 */
export async function downloadBackup(
  until: string | null,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const sheets: SheetData[] = []
  let totalRows = 0
  for (const [index, spec] of TABLES.entries()) {
    onProgress(index, TABLES.length)
    const rows = await fetchAll(spec, until)
    totalRows += rows.length
    const header = rows[0] ? Object.keys(rows[0]) : ['(sin datos)']
    sheets.push({
      name: spec.sheet,
      header,
      rows: rows.map((row) => header.map((column) => toCell(row[column]))),
    })
  }
  onProgress(TABLES.length, TABLES.length)
  const { downloadXlsx } = await import('@/lib/xlsx')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  downloadXlsx(until ? `Respaldo Dosman hasta ${until}` : `Respaldo Dosman completo ${today}`, sheets)
  return totalRows
}
