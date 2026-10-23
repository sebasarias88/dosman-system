import { RefreshCw } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/button'

const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000

/**
 * A new version is never applied automatically: reloading in the middle of a
 * sale would lose what the cashier was typing. We ask instead.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS)
    },
  })

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-card border border-line bg-surface-2 p-3 pl-4 shadow-2xl"
    >
      <RefreshCw className="size-5 shrink-0 text-fg-subtle" aria-hidden />
      <p className="flex-1 text-sm">Hay una nueva versión del sistema.</p>
      <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
        Después
      </Button>
      <Button onClick={() => void updateServiceWorker(true)}>Actualizar</Button>
    </div>
  )
}
