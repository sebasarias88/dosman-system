import type { Env } from './env'
import { errorResponse, json } from './http'
import { deleteMedia, mediaUsage, serveMedia, uploadMedia } from './media'
import { deliverPending, discoverChats, notificationStatus, runDaily, sendTest } from './notifications'
import { createStaff, updateStaff } from './staff'

/** Cron schedules (UTC) declared in wrangler.jsonc under "triggers". */
const DAILY_CRON = '30 10 * * *' // 5:30 a.m. in Colombia, after the business day closes

/**
 * API Worker. Only requests to /api/* reach this code (see `run_worker_first`
 * in wrangler.jsonc); the React app itself is served as free static assets.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)
    const method = request.method

    try {
      if (pathname === '/api/health') {
        return json({ ok: true, time: new Date().toISOString() })
      }

      if (pathname === '/api/media' && method === 'POST') {
        return await uploadMedia(request, env)
      }
      if (pathname.startsWith('/api/media/')) {
        const key = decodeURIComponent(pathname.slice('/api/media/'.length))
        if (method === 'GET') return await serveMedia(request, env, key)
        if (method === 'DELETE') return await deleteMedia(request, env, key)
      }

      if (pathname === '/api/storage/media' && method === 'GET') return await mediaUsage(request, env)

      if (pathname === '/api/staff' && method === 'POST') return await createStaff(request, env)
      if (pathname.startsWith('/api/staff/') && method === 'PATCH') {
        return await updateStaff(request, env, pathname.slice('/api/staff/'.length))
      }

      if (pathname === '/api/notifications/status' && method === 'GET')
        return await notificationStatus(request, env)
      if (pathname === '/api/notifications/chats' && method === 'POST')
        return await discoverChats(request, env)
      if (pathname === '/api/notifications/test' && method === 'POST') return await sendTest(request, env)

      return errorResponse(404, 'Ruta no encontrada')
    } catch (error) {
      console.error('Unhandled API error', error)
      return errorResponse(500, 'Error interno')
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    const job = controller.cron === DAILY_CRON ? runDaily(env) : deliverPending(env).then(() => undefined)
    ctx.waitUntil(
      job.catch((error: unknown) => {
        console.error('Scheduled job failed', controller.cron, error)
      }),
    )
  },
} satisfies ExportedHandler<Env>
