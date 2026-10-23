import { ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { mediaUrl, optimizeImage } from '@/lib/media'

export type ImageState = { kind: 'none' } | { kind: 'existing'; key: string } | { kind: 'new'; blob: Blob }

interface ImagePickerProps {
  value: ImageState
  onChange: (value: ImageState) => void
}

/** Picks a photo, optimizes it in the browser and shows a preview. Upload happens on save. */
export function ImagePicker({ value, onChange }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const previewUrl = useMemo(() => (value.kind === 'new' ? URL.createObjectURL(value.blob) : null), [value])

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const src = value.kind === 'existing' ? mediaUrl(value.key) : value.kind === 'new' ? previewUrl : null

  async function handleFile(file: File | undefined) {
    if (!file) return
    setProcessing(true)
    try {
      onChange({ kind: 'new', blob: await optimizeImage(file, 'products') })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo procesar la foto')
    } finally {
      setProcessing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2 text-fg-subtle">
        {processing ? (
          <Spinner />
        ) : src ? (
          <img src={src} alt="Foto del producto" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-7" aria-hidden />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={processing}>
          <ImagePlus className="size-4" aria-hidden />
          {src ? 'Cambiar foto' : 'Subir foto'}
        </Button>
        {src && (
          <Button variant="ghost" onClick={() => onChange({ kind: 'none' })} disabled={processing}>
            <Trash2 className="size-4" aria-hidden />
            Quitar foto
          </Button>
        )}
      </div>
    </div>
  )
}
