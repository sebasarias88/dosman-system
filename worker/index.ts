import type { Env } from './env'
import { errorResponse, json } from './http'
import { serveMedia, uploadMedia } from './media'

/**
 * API Worker. Only requests to /api/* reach this code (see `run_worker_first`
 * in wrangler.jsonc); the React app itself is served as free static assets.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)

    try {
      if (pathname === '/api/health') {
        return json({ ok: true, time: new Date().toISOString() })
      }

      if (pathname === '/api/media' && request.method === 'POST') {
        return await uploadMedia(request, env)
      }

      if (pathname.startsWith('/api/media/') && request.method === 'GET') {
        return await serveMedia(request, env, decodeURIComponent(pathname.slice('/api/media/'.length)))
      }

      return errorResponse(404, 'Ruta no encontrada')
    } catch (error) {
      console.error('Unhandled API error', error)
      return errorResponse(500, 'Error interno')
    }
  },
} satisfies ExportedHandler<Env>
