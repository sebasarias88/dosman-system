/** Report periods. Dates are "YYYY-MM-DD" business dates (the day ends at 5 a.m.). */
export type PeriodId = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'

export const PERIODS: { id: Exclude<PeriodId, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
]

const DAY = 86_400_000

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Business "today" in Colombia: before the cutoff hour it is still yesterday. */
export function businessToday(cutoffHours = 5): string {
  // Colombia is UTC-5 all year (no daylight saving).
  return iso(new Date(Date.now() - 5 * 3_600_000 - cutoffHours * 3_600_000))
}

export function addDays(date: string, days: number): string {
  return iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY))
}

export function daysBetween(from: string, to: string): number {
  return (
    Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY) + 1
  )
}

export function periodRange(
  id: Exclude<PeriodId, 'custom'>,
  today = businessToday(),
): { from: string; to: string } {
  switch (id) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const day = addDays(today, -1)
      return { from: day, to: day }
    }
    case 'week':
      return { from: addDays(today, -6), to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const firstOfThis = `${today.slice(0, 7)}-01`
      const lastOfPrevious = addDays(firstOfThis, -1)
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious }
    }
  }
}

const longDate = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const shortDate = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const monthName = new Intl.DateTimeFormat('es-CO', { month: 'short', year: '2-digit', timeZone: 'UTC' })

const toDate = (date: string) => new Date(`${date}T00:00:00Z`)

export const formatLongDate = (date: string) => longDate.format(toDate(date))
export const formatShortDate = (date: string) => shortDate.format(toDate(date))
export const formatWeekday = (date: string) => weekday.format(toDate(date))
export const formatMonth = (date: string) => monthName.format(toDate(date))

export function describeRange(from: string, to: string): string {
  return from === to ? formatLongDate(from) : `${formatShortDate(from)} – ${formatLongDate(to)}`
}
