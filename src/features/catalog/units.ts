import type { SupplyUnit } from './types'

/**
 * Supplies are stored in a base unit (g, ml, unit) so recipes can use small
 * amounts. People buy and price them in kilos and liters, so the screens
 * convert: 1 kg = 1000 g, 1 L = 1000 ml.
 */
interface UnitInfo {
  /** How the unit type is described when creating a supply. */
  kind: string
  /** Base unit used in recipes. */
  base: string
  /** Unit people use to buy it and set the price. */
  bulk: string
  /** Base units per bulk unit. */
  factor: number
}

export const UNITS: Record<SupplyUnit, UnitInfo> = {
  g: { kind: 'Peso (kilos y gramos)', base: 'g', bulk: 'kg', factor: 1000 },
  ml: { kind: 'Volumen (litros y mililitros)', base: 'ml', bulk: 'L', factor: 1000 },
  unit: { kind: 'Unidades', base: 'und', bulk: 'und', factor: 1 },
}

export const SUPPLY_UNITS = Object.keys(UNITS) as SupplyUnit[]

/** Price per kilo / liter / unit -> cost per base unit stored in the database. */
export function bulkPriceToUnitCost(unit: SupplyUnit, bulkPrice: number): number {
  return bulkPrice / UNITS[unit].factor
}

export function unitCostToBulkPrice(unit: SupplyUnit, unitCost: number): number {
  return unitCost * UNITS[unit].factor
}

export function bulkToBase(unit: SupplyUnit, bulkQuantity: number): number {
  return bulkQuantity * UNITS[unit].factor
}

export function baseToBulk(unit: SupplyUnit, baseQuantity: number): number {
  return baseQuantity / UNITS[unit].factor
}

const quantityFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 })

export function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

/**
 * Human-readable stock: "25,5 kg", "500 g", "370 und". Small amounts stay in
 * grams / milliliters so "0,05 kg" never appears.
 */
export function formatStock(unit: SupplyUnit, baseQuantity: number): string {
  const info = UNITS[unit]
  if (info.factor === 1 || Math.abs(baseQuantity) < info.factor) {
    return `${formatQuantity(Math.round(baseQuantity * 10) / 10)} ${info.base}`
  }
  return `${formatQuantity(Math.round(baseToBulk(unit, baseQuantity) * 100) / 100)} ${info.bulk}`
}
