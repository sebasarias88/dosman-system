import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './button'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  footer?: ReactNode
  size?: 'md' | 'lg'
  children: ReactNode
}

/**
 * Side panel for forms. Built on the native <dialog>, which gives focus
 * trapping, Escape to close and an inert background for free. Full screen on
 * phones, a right-hand panel on tablets and PC.
 */
export function Sheet({ open, onClose, title, description, footer, size = 'md', children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby="sheet-title"
      className={cn(
        'm-0 ml-auto h-dvh max-h-dvh w-full max-w-full bg-transparent p-0 text-fg backdrop:bg-ink/70 backdrop:backdrop-blur-[2px]',
        size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
      )}
    >
      {open && (
        <div className="flex h-full flex-col border-line bg-surface sm:border-l">
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="sheet-title" className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="text-sm text-fg-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
              <X className="size-5" aria-hidden />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="border-t border-line px-5 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
