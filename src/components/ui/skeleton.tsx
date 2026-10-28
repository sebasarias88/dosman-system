import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Placeholders shaped like the content that is about to appear. They tell the
 * person "this is loading" and keep the layout from jumping when the data
 * arrives. The pulse stops for people who turned off animations.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('block rounded-lg bg-surface-2 motion-safe:animate-pulse', className)} />
  )
}

/** Wrapper that announces the loading state once to screen readers. */
function Loading({
  className,
  children,
  nested,
}: {
  className?: string
  children: ReactNode
  nested?: boolean
}) {
  // Inside another skeleton only the outer one announces itself.
  if (nested) return <div className={className}>{children}</div>
  return (
    <div role="status" aria-live="polite" aria-busy className={className}>
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  )
}

/** Rows of a list or table (expenses, movements, staff…). */
export function ListSkeleton({
  rows = 6,
  className,
  nested,
}: {
  rows?: number
  className?: string
  nested?: boolean
}) {
  return (
    <Loading
      nested={nested}
      className={cn(
        'flex flex-col divide-y divide-line rounded-card border border-line bg-surface',
        className,
      )}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={cn('h-4', i % 3 === 0 ? 'w-2/5' : i % 3 === 1 ? 'w-3/5' : 'w-1/2')} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </Loading>
  )
}

/** Number tiles (reports, home, storage). */
export function StatsSkeleton({
  tiles = 4,
  className,
  nested,
}: {
  tiles?: number
  className?: string
  nested?: boolean
}) {
  return (
    <Loading nested={nested} className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </Loading>
  )
}

/** Big cards with a few lines each (settings, cash session, storage). */
export function CardsSkeleton({ cards = 2, className }: { cards?: number; className?: string }) {
  return (
    <Loading className={cn('flex flex-col gap-4', className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-xl" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        </div>
      ))}
    </Loading>
  )
}

/** Grid of tiles (tables, POS products). */
export function TilesSkeleton({ tiles = 12, className }: { tiles?: number; className?: string }) {
  return (
    <Loading className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', className)}>
      {Array.from({ length: tiles }, (_, i) => (
        <div
          key={i}
          className="flex h-28 flex-col justify-between rounded-card border border-line bg-surface p-4"
        >
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-5 w-2/5" />
        </div>
      ))}
    </Loading>
  )
}

/** Board columns (preparation screen). */
export function ColumnsSkeleton({ columns = 3, className }: { columns?: number; className?: string }) {
  return (
    <Loading className={cn('grid gap-3 md:grid-cols-3', className)}>
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="flex flex-col gap-3 rounded-card bg-surface/60 p-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ))}
        </div>
      ))}
    </Loading>
  )
}

/** Generic page (title + content) used while a route loads its code or data. */
export function PageSkeleton() {
  return (
    <Loading className="flex flex-col gap-6 p-4 sm:p-8">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-64 max-w-[60vw]" />
        </div>
      </div>
      <StatsSkeleton nested />
      <ListSkeleton rows={5} nested />
    </Loading>
  )
}

/**
 * First load of the app (checking the session): the shell's shape (sidebar on
 * PC, top bar on phones) so the screen doesn't jump when the real one appears.
 */
export function AppBootSkeleton() {
  return (
    <div className="flex h-full">
      <aside
        aria-hidden
        className="hidden w-64 shrink-0 flex-col gap-5 border-r border-line bg-surface p-4 lg:flex"
      >
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-11 rounded-xl" />
        <div className="flex flex-col gap-3 pt-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className={cn('h-4', i % 2 ? 'w-24' : 'w-32')} />
            </div>
          ))}
        </div>
        <Skeleton className="mt-auto h-16 rounded-xl" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden
          className="flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden"
        >
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="size-7 rounded-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PageSkeleton />
        </div>
      </div>
    </div>
  )
}
