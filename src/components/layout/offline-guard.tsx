import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * The system needs internet to register anything (sales, cash, stock).
 * When the connection drops we cover the screen so nobody keeps working on
 * data that would never reach the database.
 */
export function OfflineGuard() {
  const isOnline = useIsOnline()
  if (isOnline) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-6 backdrop-blur-sm"
    >
      <div className="max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-2xl">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-warning-soft text-warning">
          <WifiOff className="size-7" aria-hidden />
        </span>
        <h2 id="offline-title" className="text-xl font-semibold">
          Sin conexión a internet
        </h2>
        <p className="mt-3 text-fg-muted">
          No se puede registrar nada hasta que vuelva la conexión, para no perder información.
        </p>
        <p className="mt-4 rounded-xl bg-surface-2 p-4 text-sm text-fg-muted">
          Mientras tanto, comparte los datos de un celular con este equipo. La pantalla se libera sola cuando
          vuelve el internet.
        </p>
      </div>
    </div>
  )
}
