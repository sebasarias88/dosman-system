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
