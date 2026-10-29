import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Database, Download, HardDrive, Images, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { CardsSkeleton, StatsSkeleton } from '@/components/ui/skeleton'
import { requireModule } from '@/features/auth/require-module'
import { downloadBackup } from '@/features/storage/backup'
import { MonthlyHistory } from '@/features/storage/components/monthly-history'
import {
  cleanupOldData,
  formatBytes,
  mediaUsageQuery,
  recordBackup,
  usageQuery,
  type CleanupResult,
  type StorageUsage,
} from '@/features/storage/storage-api'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/errors'

export const Route = createFileRoute('/_app/storage')({
  beforeLoad: requireModule('storage'),
  component: StorageScreen,
})

/** What each table holds, in words the owner understands. */
const TABLE_LABELS: Record<string, string> = {
  stock_movements: 'Movimientos de inventario',
  order_items: 'Productos vendidos',
  orders: 'Pedidos',
  payments: 'Pagos',
  audit_log: 'Registro de actividad',
  notification_outbox: 'Avisos enviados',
  cash_sessions: 'Turnos de caja',
  cash_movements: 'Entradas y salidas de caja',
  expenses: 'Gastos',
  products: 'Productos',
  product_variants: 'Tamaños',
  supplies: 'Insumos',
  recipe_items: 'Recetas',
  customers: 'Clientes',
  purchases: 'Compras',
  purchase_items: 'Detalle de compras',
  transfers: 'Envíos entre sedes',
  transfer_items: 'Detalle de envíos',
  supply_stock: 'Existencias',
  monthly_summaries: 'Resúmenes mensuales',
  customer_payments: 'Abonos',
  profiles: 'Empleados',
  inventory_counts: 'Conteos',
  inventory_count_items: 'Detalle de conteos',
  supplier_payments: 'Pagos a proveedores',
  add_ons: 'Adiciones',
  categories: 'Categorías',
  dining_tables: 'Mesas',
  zones: 'Zonas',
}

const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const formatMonth = (date: string) => monthName.format(new Date(`${date.slice(0, 10)}T00:00:00Z`))

function Meter({ used, limit, warning }: { used: number; limit: number; warning: number }) {
  const percent = Math.min((used / limit) * 100, 100)
  const tone = percent >= 90 ? 'bg-danger' : percent >= warning ? 'bg-warning' : 'bg-chart'
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label={`${Math.round(percent)} % usado`}
      className="h-3 overflow-hidden rounded-full bg-surface-2"
    >
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(percent, 1)}%` }} />
    </div>
  )
}

function useInvalidateStorage() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['storage'] })
}

function StorageScreen() {
  const { data: usage, isPending, isError } = useQuery(usageQuery)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <HardDrive className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Espacio</h1>
          <p className="text-fg-muted">Cuánto ocupa el sistema, respaldos y limpieza de datos viejos.</p>
        </div>
      </header>

      {isPending ? (
        <CardsSkeleton />
      ) : isError || !usage ? (
        <p className="p-8 text-center text-danger">No se pudo consultar el espacio. Intenta de nuevo.</p>
      ) : (
        <>
          <UsageSection usage={usage} />
          <BackupSection usage={usage} />
          <CleanupSection usage={usage} />
          <MonthlyHistory />
        </>
      )}
    </div>
  )
}

function UsageSection({ usage }: { usage: StorageUsage }) {
  const media = useQuery(mediaUsageQuery)
  const percent = Math.round((usage.database_bytes / usage.limit_bytes) * 100)
  const months = Math.max(usage.months.length, 1)
  const perMonth = usage.database_bytes / months
  const monthsLeft = perMonth > 0 ? Math.floor((usage.limit_bytes - usage.database_bytes) / perMonth) : null
  const top = usage.tables.slice(0, 6)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Database className="size-5 text-fg-subtle" aria-hidden />
          Base de datos
        </h2>
        <p className="text-2xl font-semibold tabular-nums">
          {formatBytes(usage.database_bytes)}{' '}
          <span className="text-base font-normal text-fg-muted">de {formatBytes(usage.limit_bytes)}</span>
        </p>
        <Meter used={usage.database_bytes} limit={usage.limit_bytes} warning={usage.warning_percent} />
        <p className={cn('text-sm', percent >= usage.warning_percent ? 'text-warning' : 'text-fg-muted')}>
          {percent} % usado.{' '}
          {percent >= usage.warning_percent
            ? 'Conviene descargar un respaldo y limpiar los meses más viejos.'
            : monthsLeft !== null && usage.months.length > 0
              ? `A este ritmo alcanza para ${monthsLeft > 120 ? 'más de 10 años' : `unos ${monthsLeft} meses más`}.`
              : 'Hay espacio de sobra.'}
        </p>
        <ul className="mt-1 flex flex-col gap-1.5 text-sm">
          {top.map((t) => (
            <li key={t.name} className="flex justify-between gap-3">
              <span className="text-fg-muted">{TABLE_LABELS[t.name] ?? t.name}</span>
              <span className="tabular-nums">{formatBytes(t.bytes)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Images className="size-5 text-fg-subtle" aria-hidden />
          Fotos (productos y recibos)
        </h2>
        {media.isPending ? (
          <StatsSkeleton tiles={2} className="lg:grid-cols-2" />
        ) : media.isError || !media.data ? (
          <p className="text-sm text-fg-subtle">No se pudo consultar el espacio de fotos en este momento.</p>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {formatBytes(media.data.products.bytes + media.data.receipts.bytes)}{' '}
              <span className="text-base font-normal text-fg-muted">
                de {formatBytes(media.data.limit_bytes)}
              </span>
            </p>
            <Meter
              used={media.data.products.bytes + media.data.receipts.bytes}
              limit={media.data.limit_bytes}
              warning={usage.warning_percent}
            />
            <ul className="flex flex-col gap-1.5 text-sm">
              <li className="flex justify-between">
                <span className="text-fg-muted">Fotos de productos ({media.data.products.files})</span>
                <span className="tabular-nums">{formatBytes(media.data.products.bytes)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-fg-muted">Recibos y facturas ({media.data.receipts.files})</span>
                <span className="tabular-nums">{formatBytes(media.data.receipts.bytes)}</span>
              </li>
            </ul>
            <p className="text-sm text-fg-muted">
              Las fotos se guardan comprimidas (unos 100 KB cada una), así que este espacio dura muchísimo.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function useBackup() {
  const invalidate = useInvalidateStorage()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const mutation = useMutation({
    mutationFn: async (until: string | null) => {
      const rows = await downloadBackup(until, (done, total) => setProgress({ done, total }))
      await recordBackup(until)
      return rows
    },
    onSuccess: (rows) => {
      invalidate()
      toast.success(`Respaldo descargado (${new Intl.NumberFormat('es-CO').format(rows)} registros)`)
    },
    onError: (error) =>
      toast.error(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error)),
    onSettled: () => setProgress(null),
  })
  return { ...mutation, progress }
}

function BackupSection({ usage }: { usage: StorageUsage }) {
  const backup = useBackup()
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-5 text-fg-subtle" aria-hidden />
        Respaldo en Excel
      </h2>
      <p className="text-sm text-fg-muted">
        Descarga toda la información del negocio en un archivo de Excel (una hoja por tema). Guárdalo en tu
        computador o en Google Drive. Recomendado una vez al mes.
      </p>
      <p className="text-sm text-fg-subtle">
        {usage.last_backup_at
          ? `Último respaldo: ${formatDateTime(usage.last_backup_at)}`
          : 'Aún no se ha descargado ningún respaldo.'}
      </p>
      <Button className="self-start" loading={backup.isPending} onClick={() => backup.mutate(null)}>
        <Download className="size-4" aria-hidden />
        Descargar respaldo completo
      </Button>
      {backup.progress && (
        <p className="text-sm text-fg-muted" aria-live="polite">
          Preparando… {backup.progress.done} de {backup.progress.total} hojas
        </p>
      )}
    </section>
  )
}

function CleanupSection({ usage }: { usage: StorageUsage }) {
  const invalidate = useInvalidateStorage()
  const backup = useBackup()
  const [before, setBefore] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [result, setResult] = useState<CleanupResult | null>(null)
  const cleanup = useMutation({
    mutationFn: cleanupOldData,
    onSuccess: (data) => {
      setResult(data)
      setConfirmation('')
      invalidate()
      toast.success('Limpieza terminada')
    },
    onError: (error) => toast.error(toUserMessage(error)),
  })

  // Time of opening the screen (render must not read the clock).
  const [openedAt] = useState(() => Date.now())
  // Cleanable months: older than the last 3 complete months.
  const now = new Date(openedAt)
  const limit = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 10)
  const oldMonths = usage.months.filter((m) => m.month.slice(0, 10) < limit)
  // Option value = first day of the month AFTER the chosen one (clean "up to and including").
  const options = oldMonths.map((m) => {
    const d = new Date(`${m.month.slice(0, 10)}T00:00:00Z`)
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    return { value: next, label: formatMonth(m.month) }
  })
  const ordersToClean = oldMonths
    .filter((m) => before && m.month.slice(0, 10) < before)
    .reduce((s, m) => s + m.orders, 0)
  const backupReady =
    Boolean(before) &&
    usage.last_backup_until !== null &&
    usage.last_backup_until >= before &&
    usage.last_backup_at !== null &&
    openedAt - new Date(usage.last_backup_at).getTime() < 24 * 3_600_000

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Trash2 className="size-5 text-fg-subtle" aria-hidden />
        Limpiar datos viejos
      </h2>
      <p className="text-sm text-fg-muted">
        Borra el detalle de las ventas viejas y el registro de actividad de esos meses. Antes se guarda el
        resumen de cada mes (ventas, costos, gastos), así que los totales no se pierden. Nunca se borran los
        fiados ni los abonos, los gastos, las compras ni los cierres de caja, y los últimos 3 meses siempre se
        conservan.
      </p>
      {usage.data_cleaned_before && (
        <p className="text-sm text-fg-subtle">
          Ya se limpió todo lo anterior a {formatMonth(usage.data_cleaned_before)}.
        </p>
      )}

      {options.length === 0 ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-fg-muted">
          Todavía no hay meses para limpiar: todo es de los últimos 3 meses.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          <li className="flex flex-col gap-2">
            <Field label="1. Limpiar hasta el mes de (incluido)">
              {(props) => (
                <Select
                  {...props}
                  placeholder="Elegir mes…"
                  value={before}
                  onValueChange={setBefore}
                  searchable={false}
                  options={options}
                />
              )}
            </Field>
            {before && (
              <p className="text-sm text-fg-muted">
                Se borrará el detalle de unos {new Intl.NumberFormat('es-CO').format(ordersToClean)} pedidos.
              </p>
            )}
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">2. Descargar el respaldo de ese periodo</span>
            <Button
              variant="secondary"
              className="self-start"
              disabled={!before}
              loading={backup.isPending}
              onClick={() => backup.mutate(before)}
            >
              <Download className="size-4" aria-hidden />
              {backupReady ? 'Respaldo listo · descargar otra vez' : 'Descargar respaldo'}
            </Button>
            {backup.progress && (
              <p className="text-sm text-fg-muted" aria-live="polite">
                Preparando… {backup.progress.done} de {backup.progress.total} hojas
              </p>
            )}
          </li>
          <li className="flex flex-col gap-2">
            <Field label="3. Escribe BORRAR para confirmar">
              {(props) => (
                <TextInput
                  {...props}
                  autoCapitalize="characters"
                  disabled={!backupReady}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              )}
            </Field>
            <Button
              variant="danger"
              className="self-start"
              disabled={!backupReady || confirmation !== 'BORRAR'}
              loading={cleanup.isPending}
              onClick={() => cleanup.mutate({ before, confirmation })}
            >
              <Trash2 className="size-4" aria-hidden />
              Limpiar
            </Button>
          </li>
        </ol>
      )}

      {result && (
        <div className="rounded-xl bg-success-soft p-4 text-sm text-success">
          Se borraron {result.orders} pedidos, {result.order_items} productos vendidos,{' '}
          {result.stock_movements} movimientos de inventario y {result.audit_log} registros de actividad. El
          espacio se libera en las próximas horas.
        </div>
      )}
    </section>
  )
}
