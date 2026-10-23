import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getPrintContent, getPrintSettings, subscribePrint, subscribePrintSettings } from './print-store'

/** Mounted once at the root: holds the ticket that is being printed. */
export function PrintHost() {
  const content = useSyncExternalStore(subscribePrint, getPrintContent, () => null)
  return createPortal(<div id="print-root">{content}</div>, document.body)
}

export function usePrintSettings() {
  return useSyncExternalStore(subscribePrintSettings, getPrintSettings, getPrintSettings)
}
