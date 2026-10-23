import { Camera, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { optimizeImage } from '@/lib/media'

interface ReceiptPickerProps {
  value: Blob | null
  onChange: (blob: Blob | null) => void
}

/** Takes a photo of the receipt (camera on phones) and shrinks it before upload. */
export function ReceiptPicker({ value, onChange }: ReceiptPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      onChange(await optimizeImage(file, 'receipts'))
    } catch {
      toast.error('No se pudo leer la foto. Intenta con otra.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
        <Camera className="size-4" aria-hidden />
        {value ? 'Cambiar foto del recibo' : 'Foto del recibo (opcional)'}
      </Button>
      {value && (
        <>
          <span className="text-xs text-success">Foto lista ({Math.round(value.size / 1024)} KB)</span>
          <Button variant="ghost" size="icon" aria-label="Quitar foto" onClick={() => onChange(null)}>
            <X className="size-4" aria-hidden />
          </Button>
        </>
      )}
    </div>
  )
}
