import { getStaffSession, isManager } from './auth'
import type { Env } from './env'
import { errorResponse, isSameOrigin, json } from './http'

/** Folders inside the bucket and who may write to each one. */
const FOLDERS = {
  /** Product photos: shown on every POS screen, so they are public to read. */
  products: { publicRead: true, managersOnly: true },
  /** Expense receipts: private, any active staff member can attach one. */
  receipts: { publicRead: false, managersOnly: false },
} as const

type Folder = keyof typeof FOLDERS

const MAX_UPLOAD_BYTES = 1_500_000
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png'])
const KEY_PATTERN = /^(products|receipts)\/[0-9a-f-]{36}\.(webp|jpg|png)$/

function isFolder(value: string | null): value is Folder {
  return value !== null && value in FOLDERS
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  return 'webp'
}

/** POST /api/media?folder=products|receipts — body is the already-optimized image. */
export async function uploadMedia(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request)) return errorResponse(403, 'Origen no permitido')

  const session = await getStaffSession(request, env)
  if (!session) return errorResponse(401, 'Sesión no válida')

  const folder = new URL(request.url).searchParams.get('folder')
  if (!isFolder(folder)) return errorResponse(400, 'Carpeta no válida')
  if (FOLDERS[folder].managersOnly && !isManager(session)) {
    return errorResponse(403, 'No tienes permiso para subir esta imagen')
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!ALLOWED_TYPES.has(contentType)) return errorResponse(415, 'Formato de imagen no permitido')

  const declaredSize = Number(request.headers.get('content-length') ?? '0')
  if (!declaredSize || declaredSize > MAX_UPLOAD_BYTES) {
    return errorResponse(413, 'La imagen es demasiado pesada')
  }

  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_UPLOAD_BYTES) return errorResponse(413, 'La imagen es demasiado pesada')

  const key = `${folder}/${crypto.randomUUID()}.${extensionFor(contentType)}`
  await env.MEDIA.put(key, body, {
    httpMetadata: {
      contentType,
      // Keys are unique and never overwritten, so the file can be cached forever.
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { uploadedBy: session.userId },
  })

  return json({ key }, { status: 201 })
}

/** GET /api/media/<key> */
export async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  if (!KEY_PATTERN.test(key)) return errorResponse(404, 'No encontrado')

  const folder = key.split('/')[0] as Folder
  if (!FOLDERS[folder].publicRead) {
    const session = await getStaffSession(request, env)
    if (!session) return errorResponse(401, 'Sesión no válida')
  }

  const object = await env.MEDIA.get(key)
  if (!object) return errorResponse(404, 'No encontrado')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  if (!FOLDERS[folder].publicRead) headers.set('cache-control', 'private, max-age=3600')
  return new Response(object.body, { headers })
}
