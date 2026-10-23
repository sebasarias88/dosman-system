import { supabase } from './supabase'

export type MediaFolder = 'products' | 'receipts'

/** Weight budgets per folder (bytes) and longest side in pixels. */
const PRESETS: Record<MediaFolder, { maxSide: number; maxBytes: number }> = {
  // Product photos are shown small on the POS buttons and in lists.
  products: { maxSide: 800, maxBytes: 120_000 },
  // Receipts must stay readable, so they keep more resolution.
  receipts: { maxSide: 1600, maxBytes: 350_000 },
}

export function mediaUrl(key: string): string {
  return `/api/media/${key}`
}

/** Receipts are private: they are fetched with the session token and opened as a blob. */
export async function openPrivateMedia(key: string): Promise<void> {
  // Open the tab first (inside the click) so the browser does not block it as a popup.
  const tab = window.open('', '_blank')
  const response = await fetch(mediaUrl(key), { headers: await authHeader() })
  if (!response.ok) {
    tab?.close()
    throw new Error(await readError(response))
  }
  const url = URL.createObjectURL(await response.blob())
  if (tab) tab.location.href = url
  else window.location.assign(url)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen. Usa una foto JPG, PNG o WebP.'))
    }
    image.src = url
  })
}

/**
 * Resizes and converts the photo to WebP in the browser before uploading, so
 * a 4 MB phone photo becomes ~100 KB. Quality steps down until it fits the budget.
 */
export async function optimizeImage(file: File, folder: MediaFolder): Promise<Blob> {
  const { maxSide, maxBytes } = PRESETS[folder]
  const image = await loadImage(file)
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Este navegador no puede procesar imágenes.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  let quality = 0.85
  let blob: Blob | null = null
  while (quality >= 0.45) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (blob && blob.size <= maxBytes) return blob
    quality -= 0.1
  }
  if (!blob) throw new Error('No se pudo convertir la imagen.')
  return blob
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Tu sesión expiró. Vuelve a ingresar.')
  return { authorization: `Bearer ${token}` }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? 'No se pudo subir la imagen.'
  } catch {
    return 'No se pudo subir la imagen.'
  }
}

/** Uploads an already optimized image and returns its R2 key. */
export async function uploadMedia(blob: Blob, folder: MediaFolder): Promise<string> {
  const response = await fetch(`/api/media?folder=${folder}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'content-type': blob.type },
    body: blob,
  })
  if (!response.ok) throw new Error(await readError(response))
  const { key } = (await response.json()) as { key: string }
  return key
}

/** Best effort: an orphan photo only wastes a few KB, so failures are ignored. */
export async function deleteMedia(key: string): Promise<void> {
  try {
    await fetch(mediaUrl(key), { method: 'DELETE', headers: await authHeader() })
  } catch {
    // Ignored on purpose.
  }
}
