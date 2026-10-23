export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, { status })
}

/**
 * Rejects cross-site writes. Browsers always send Origin on POST/PUT/DELETE,
 * so a missing or foreign Origin means the call did not come from our app.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  return origin === new URL(request.url).origin
}
