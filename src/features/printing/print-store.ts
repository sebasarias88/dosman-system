import type { ReactNode } from 'react'

/**
 * Tickets are printed with the browser's print dialog on an 80 mm thermal
 * printer. On the cashier PC, Chrome is opened with --kiosk-printing so it
 * prints straight to the default printer without asking.
 */
type Listener = () => void

let current: ReactNode = null
const listeners = new Set<Listener>()

export function subscribePrint(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPrintContent(): ReactNode {
  return current
}

function setContent(node: ReactNode) {
  current = node
  listeners.forEach((notify) => notify())
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Renders the ticket off-screen, waits for its images and prints it. */
export async function printTicket(ticket: ReactNode): Promise<void> {
  setContent(ticket)
  await nextFrame()
  await nextFrame()
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('#print-root img'))
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)))
  window.print()
  setContent(null)
}

// ---------------------------------------------------------------------------
// Per-device print preferences (a convenience: each PC decides).
// ---------------------------------------------------------------------------
export interface PrintSettings {
  /** Print the receipt automatically after charging. */
  autoReceipt: boolean
  /** Print the kitchen ticket automatically when an order is sent. */
  autoKitchen: boolean
}

const SETTINGS_KEY = 'dosman.print-settings'
const DEFAULT_SETTINGS: PrintSettings = { autoReceipt: true, autoKitchen: true }
const settingsListeners = new Set<Listener>()
let cachedRaw: string | null | undefined
let cachedSettings: PrintSettings = DEFAULT_SETTINGS

function readStoredSettings(): string | null {
  try {
    return window.localStorage.getItem(SETTINGS_KEY)
  } catch {
    return null
  }
}

export function getPrintSettings(): PrintSettings {
  const raw = readStoredSettings()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cachedSettings = raw
        ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PrintSettings>) }
        : DEFAULT_SETTINGS
    } catch {
      cachedSettings = DEFAULT_SETTINGS
    }
  }
  return cachedSettings
}

export function setPrintSettings(patch: Partial<PrintSettings>): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getPrintSettings(), ...patch }))
  } catch {
    // Storage blocked: the preference lasts only for this page view.
    cachedSettings = { ...cachedSettings, ...patch }
  }
  settingsListeners.forEach((notify) => notify())
}

export function subscribePrintSettings(listener: Listener): () => void {
  settingsListeners.add(listener)
  return () => settingsListeners.delete(listener)
}
