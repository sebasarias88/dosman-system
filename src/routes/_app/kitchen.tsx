import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BellRing, Check, ChefHat, Flame, Trees, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColumnsSkeleton } from '@/components/ui/skeleton'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { useNow } from '@/features/sales/pos/open-orders'
import { kitchenQuery, setPrepStatus } from '@/features/sales/sales-api'
import { ORDER_TYPE_LABELS, type KitchenItem, type PrepStatus } from '@/features/sales/types'
import { useSalesMutation } from '@/features/sales/use-sales-mutation'
import { cn } from '@/lib/cn'
import { formatElapsed, formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/kitchen')({
  beforeLoad: requireModule('kitchen'),
  staticData: { compactShell: true },
  component: KitchenScreen,
})

type Column = Exclude<PrepStatus, 'served'>

const COLUMNS: { status: Column; title: string; next: PrepStatus; action: string }[] = [
  { status: 'pending', title: 'Por preparar', next: 'preparing', action: 'Empezar' },
  { status: 'preparing', title: 'Preparando', next: 'ready', action: 'Listo' },
  { status: 'ready', title: 'Listo para entregar', next: 'served', action: 'Entregado' },
]

interface Ticket {
  orderId: string
  order: KitchenItem['orders']
  items: KitchenItem[]
  /** When the oldest item of this group arrived. */
  since: string
}

function groupByOrder(items: KitchenItem[], status: Column): Ticket[] {
  const groups = new Map<string, Ticket>()
  for (const item of items) {
    if (item.prep_status !== status) continue
    const group = groups.get(item.order_id) ?? {
      orderId: item.order_id,
      order: item.orders,
      items: [],
      since: item.created_at,
    }
    group.items.push(item)
    if (item.created_at < group.since) group.since = item.created_at
    groups.set(item.order_id, group)
  }
  return [...groups.values()].sort((a, b) => a.since.localeCompare(b.since))
}

function where(order: KitchenItem['orders']): string {
  if (order.order_type === 'table') return order.dining_tables?.name ?? 'Mesa'
  if (order.order_type === 'park') return order.park_note ?? 'Parque'
  if (order.order_type === 'delivery') return `Domicilio · ${order.customers?.name ?? ''}`
  return ORDER_TYPE_LABELS[order.order_type]
}

// ---------------------------------------------------------------------------
// New-order chime (Web Audio, no file to download). Browsers only allow sound
// after the person touches the screen once, hence the "Activar sonido" button.
// ---------------------------------------------------------------------------
const SOUND_KEY = 'dosman.kitchen-sound'

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

function chime(context: AudioContext) {
  const start = context.currentTime
  for (const [index, frequency] of [880, 1320].entries()) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start + index * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.25, start + index * 0.18 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.18 + 0.3)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start + index * 0.18)
    oscillator.stop(start + index * 0.18 + 0.32)
  }
}

function KitchenScreen() {
  const { activeBranch } = useStaff()
  const now = useNow(15_000)
  const { data: items = [], isPending } = useQuery({
    ...kitchenQuery(activeBranch?.id ?? ''),
    enabled: !!activeBranch,
  })
  const [mobileColumn, setMobileColumn] = useState<Column>('pending')
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [audio, setAudio] = useState<AudioContext | null>(null)
  const queryClient = useQueryClient()
  const advance = useSalesMutation(({ ids, next }: { ids: string[]; next: PrepStatus }) =>
    setPrepStatus(ids, next),
  )
  // Tickets being moved ("orderId:status"). The spinner stays until the ticket
  // really shows up in its next column, so nobody taps twice.
  const [advancing, setAdvancing] = useState<ReadonlySet<string>>(new Set())

  async function advanceTicket(ticket: Ticket, column: (typeof COLUMNS)[number]) {
    const key = `${ticket.orderId}:${column.status}`
    setAdvancing((current) => new Set(current).add(key))
    try {
      await advance.mutateAsync({ ids: ticket.items.map((i) => i.id), next: column.next })
      await queryClient.invalidateQueries({ queryKey: kitchenQuery(activeBranch?.id ?? '').queryKey })
    } catch {
      // The error toast is shown by useSalesMutation.
    } finally {
      setAdvancing((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const tickets = useMemo(
    () =>
      Object.fromEntries(COLUMNS.map((c) => [c.status, groupByOrder(items, c.status)])) as Record<
        Column,
        Ticket[]
      >,
    [items],
  )

  // Chime when a pending item appears that wasn't there before.
  const knownPending = useRef<Set<string> | null>(null)
  useEffect(() => {
    const pendingIds = items.filter((i) => i.prep_status === 'pending').map((i) => i.id)
    const previous = knownPending.current
    knownPending.current = new Set(pendingIds)
    if (previous && soundOn && audio && pendingIds.some((id) => !previous.has(id))) chime(audio)
  }, [items, soundOn, audio])

  function toggleSound() {
    const next = !(soundOn && audio)
    if (next && !audio) setAudio(new AudioContext())
    setSoundOn(next)
    try {
      window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off')
    } catch {
      // The preference simply won't be remembered.
    }
  }

  if (!activeBranch) return null
  if (isPending) return <ColumnsSkeleton className="p-3" />

  const soundActive = soundOn && audio !== null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <ChefHat className="size-6" aria-hidden />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Preparación</h1>
          <p className="text-sm text-fg-muted">{activeBranch.name}</p>
        </div>
        <Button variant={soundActive ? 'secondary' : 'primary'} onClick={toggleSound}>
          {soundActive ? (
            <Volume2 className="size-4" aria-hidden />
          ) : (
            <VolumeX className="size-4" aria-hidden />
          )}
          {soundActive ? 'Sonido activo' : 'Activar sonido'}
        </Button>
      </header>

      {/* Phones: one column at a time. */}
      <div className="flex gap-1 border-b border-line p-2 md:hidden" role="tablist" aria-label="Columnas">
        {COLUMNS.map((c) => (
          <button
            key={c.status}
            type="button"
            role="tab"
            aria-selected={mobileColumn === c.status}
            onClick={() => setMobileColumn(c.status)}
            className={cn(
              'h-10 flex-1 rounded-lg text-sm font-medium',
              mobileColumn === c.status ? 'bg-surface-3 text-fg' : 'text-fg-muted',
            )}
          >
            {c.title.split(' ')[0]} ({tickets[c.status].length})
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-3">
        {COLUMNS.map((column) => (
          <section
            key={column.status}
            aria-labelledby={`col-${column.status}`}
            className={cn(
              'min-h-0 flex-col gap-3 overflow-y-auto rounded-card bg-surface/60 p-3',
              mobileColumn === column.status ? 'flex' : 'hidden md:flex',
            )}
          >
            <h2 id={`col-${column.status}`} className="flex items-center justify-between px-1 font-semibold">
              {column.title}
              <Badge>{tickets[column.status].length}</Badge>
            </h2>
            {tickets[column.status].length === 0 && (
              <p className="px-1 py-6 text-center text-sm text-fg-subtle">Nada por aquí.</p>
            )}
            {tickets[column.status].map((ticket) => (
              <TicketCard
                key={ticket.orderId}
                ticket={ticket}
                status={column.status}
                actionLabel={column.action}
                now={now}
                busy={advancing.has(`${ticket.orderId}:${column.status}`)}
                onAdvance={() => void advanceTicket(ticket, column)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function TicketCard({
  ticket,
  status,
  actionLabel,
  now,
  busy,
  onAdvance,
}: {
  ticket: Ticket
  status: Column
  actionLabel: string
  now: number
  busy: boolean
  onAdvance: () => void
}) {
  const minutes = (now - new Date(ticket.since).getTime()) / 60_000
  const late = status !== 'ready' && minutes > 15
  const veryLate = status !== 'ready' && minutes > 25
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-card border bg-surface p-4',
        veryLate ? 'border-danger' : late ? 'border-warning' : 'border-line',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums">#{ticket.order.order_number}</p>
          <p className="flex items-center gap-1.5 truncate font-medium">
            {ticket.order.order_type === 'park' && <Trees className="size-4 shrink-0" aria-hidden />}
            {where(ticket.order)}
          </p>
        </div>
        <span className="text-right text-sm">
          <span
            className={cn(
              'flex items-center justify-end gap-1 font-medium',
              veryLate ? 'text-danger' : late ? 'text-warning' : 'text-fg-muted',
            )}
          >
            {late && <Flame className="size-4" aria-hidden />}
            {formatElapsed(ticket.since, now)}
          </span>
          <span className="text-fg-subtle">{formatTime(ticket.since)}</span>
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {ticket.items.map((item) => (
          <li key={item.id} className="text-[1.05rem] leading-snug">
            <b className="tabular-nums">{item.quantity}×</b> {item.product_name}
            {item.variant_name !== 'Único' && <span className="text-fg-muted"> · {item.variant_name}</span>}
            {item.add_ons.length > 0 && (
              <span className="block pl-6 text-sm text-fg-muted">
                + {item.add_ons.map((a) => a.name).join(', ')}
              </span>
            )}
            {item.notes && (
              <span className="block pl-6 text-sm font-medium text-warning">» {item.notes}</span>
            )}
          </li>
        ))}
      </ul>

      <Button
        size="lg"
        variant={status === 'ready' ? 'secondary' : 'primary'}
        onClick={onAdvance}
        loading={busy}
      >
        {status === 'ready' ? (
          <BellRing className="size-5" aria-hidden />
        ) : (
          <Check className="size-5" aria-hidden />
        )}
        {actionLabel}
      </Button>
    </article>
  )
}
