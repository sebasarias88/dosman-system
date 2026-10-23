const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const preciseCurrencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 2,
})

/** 12000 -> "$ 12.000" */
export function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

/** Keeps cents for tiny unit costs: 0.3 -> "$ 0,3" (cost of one gram of ice). */
export function formatUnitCost(value: number): string {
  return value >= 100 ? currencyFormatter.format(value) : preciseCurrencyFormatter.format(value)
}

export function formatPercent(value: number): string {
  return `${Math.round(value)} %`
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
})

const timeFormatter = new Intl.DateTimeFormat('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' })

export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(typeof value === 'string' ? new Date(value) : value)
}

export function formatTime(value: string | Date): string {
  return timeFormatter.format(typeof value === 'string' ? new Date(value) : value)
}

/** "hace 12 min", "hace 1 h 5 min" — how long an order has been waiting. */
export function formatElapsed(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
