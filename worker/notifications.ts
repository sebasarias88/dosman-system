import { getStaffSession } from './auth'
import type { Env } from './env'
import { errorResponse, isSameOrigin, json } from './http'
import { ServerError, serverRpc } from './server'
import { botUsername, findChats, html, sendMessage, telegramConfigured } from './telegram'

/*
 * Notifications. Database functions only queue rows in notification_outbox
 * (same transaction as the action, so nothing is lost). A Cloudflare cron
 * delivers them to Telegram every few minutes and marks them as sent.
 */

interface Pending {
  id: number
  kind: string
  branch_name: string | null
  payload: Record<string, unknown>
  attempts: number
  actor_name: string | null
  created_at: string
}

interface Settings {
  business_name: string
  timezone: string
  telegram_chat_id: string | null
  notify_alerts: boolean
  notify_low_stock: boolean
  notify_cash_close: boolean
  notify_daily_summary: boolean
}

// ---------------------------------------------------------------------------
// Message text
// ---------------------------------------------------------------------------
const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})
const money = (value: unknown) => currency.format(Number(value ?? 0))
const num = (d: Record<string, unknown>, key: string) => Number(d[key] ?? 0)
const str = (d: Record<string, unknown>, key: string) => html(d[key] ?? '')

function quantity(unit: unknown, base: number): string {
  const n = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
  if (unit === 'g') return base >= 1000 ? `${n.format(base / 1000)} kg` : `${n.format(base)} g`
  if (unit === 'ml') return base >= 1000 ? `${n.format(base / 1000)} L` : `${n.format(base)} ml`
  return `${n.format(base)} und`
}

const ROLE_NAMES: Record<string, string> = {
  owner: 'dueño',
  admin: 'administrador',
  cashier: 'cajero',
  waiter: 'mesero',
  kitchen: 'cocina',
}

/** The main line of an alert, in plain Spanish. */
function alertText(action: string, d: Record<string, unknown>): string {
  const reason = d.reason ? `\nMotivo: <i>${str(d, 'reason')}</i>` : ''
  switch (action) {
    case 'cash.close': {
      const diff = num(d, 'difference')
      return `${diff < 0 ? `<b>FALTANTE de ${money(-diff)}</b>` : `Sobrante de ${money(diff)}`} al cerrar la caja\nEsperado ${money(d.expected_cash)} · Contado ${money(d.counted_cash)}`
    }
    case 'order_item.void':
      return `Anuló ${num(d, 'quantity')}× ${str(d, 'product')} (${money(d.amount)}) del pedido #${num(d, 'order_number')}${reason}`
    case 'order.cancel':
      return `Canceló el pedido #${num(d, 'order_number')} (${money(d.amount)})${reason}`
    case 'order.discount':
      return `Descuento de ${money(d.discount)} en el pedido #${num(d, 'order_number')}${reason}`
    case 'inventory.waste':
      return `Merma de ${quantity(d.unit, num(d, 'quantity'))} de ${str(d, 'supply')} (${money(d.value)})${reason}`
    case 'inventory.count':
      return `Conteo físico con faltantes por ${money(d.shortage_value)}`
    case 'transfer.receive':
      return `Envío recibido con diferencias (faltan ${money(d.missing_value)})${d.notes ? `\nNota: <i>${str(d, 'notes')}</i>` : ''}`
    case 'transfer.cancel':
      return `Canceló un envío entre sedes${reason}`
    case 'expense.created':
      return `Sacó ${money(d.amount)} de la caja para un gasto: ${str(d, 'description')}`
    case 'expense.voided':
      return `Anuló un gasto de ${money(d.amount)}: ${str(d, 'description')}${reason}`
    case 'product_variant.price_change':
    case 'add_on.price_change':
      return `Cambió un precio (${str(d, 'name')}): ${money(d.old_price)} → ${money(d.new_price)}`
    case 'staff.updated':
      if (d.is_active === false) return `Desactivó al empleado ${str(d, 'name')}`
      if (d.is_active === true) return `Volvió a activar al empleado ${str(d, 'name')}`
      return `Cambió el rol de ${str(d, 'name')} a ${html(ROLE_NAMES[String(d.new_role)] ?? d.new_role)}`
    default:
      return html(action)
  }
}

function render(entry: Pending): string {
  const where = entry.branch_name ? ` · ${html(entry.branch_name)}` : ''
  const p = entry.payload
  switch (entry.kind) {
    case 'audit_alert': {
      const icon = p.severity === 'critical' ? '🔴' : '🟠'
      const who = entry.actor_name ? `\n<i>${html(entry.actor_name)}</i>` : ''
      const details = (p.details ?? {}) as Record<string, unknown>
      return `${icon} <b>Alerta${where}</b>\n${alertText(String(p.action), details)}${who}`
    }
    case 'low_stock':
      return `📦 <b>Inventario bajo${where}</b>\n${str(p, 'supply')}: quedan ${quantity(p.unit, num(p, 'quantity'))} (mínimo ${quantity(p.unit, num(p, 'min_quantity'))})`
    case 'cash_session_closed': {
      const diff = num(p, 'difference')
      const methods = Array.isArray(p.by_method)
        ? (p.by_method as { name: string; total: number }[])
            .map((m) => `• ${html(m.name)}: ${money(m.total)}`)
            .join('\n')
        : ''
      return [
        `🧾 <b>Cierre de caja${where}</b>`,
        `Ventas ${money(p.net_sales)} · ${num(p, 'paid_orders')} pedidos`,
        methods,
        `Efectivo esperado ${money(p.expected_cash)} · contado ${money(p.counted_cash)}`,
        diff === 0
          ? '✅ Cuadró'
          : diff < 0
            ? `🔴 <b>Faltante ${money(-diff)}</b>`
            : `🟠 Sobrante ${money(diff)}`,
        entry.actor_name ? `<i>Cerró ${html(entry.actor_name)}</i>` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'daily_summary': {
      const branches = (p.branches ?? []) as Record<string, unknown>[]
      const lines = branches.map(
        (b) =>
          `<b>${str(b, 'name')}</b>\nVentas ${money(b.sales)} (${num(b, 'orders')} pedidos) · ganancia bruta ${money(b.gross_profit)}${num(b, 'cash_difference') < 0 ? `\n🔴 Faltante de caja ${money(-num(b, 'cash_difference'))}` : ''}`,
      )
      const total = branches.reduce((sum, b) => sum + num(b, 'sales'), 0)
      return [
        `📊 <b>Resumen del ${str(p, 'date')}</b>`,
        ...lines,
        `Total ventas: <b>${money(total)}</b>`,
        num(p, 'alerts') > 0
          ? `⚠️ ${num(p, 'alerts')} alertas ese día (ver Actividad)`
          : '✅ Sin alertas ese día',
        num(p, 'open_sessions') > 0 ? `🟠 Hay ${num(p, 'open_sessions')} caja(s) sin cerrar` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    }
    default:
      return html(entry.kind)
  }
}

function wanted(kind: string, s: Settings): boolean {
  if (kind === 'audit_alert') return s.notify_alerts
  if (kind === 'low_stock') return s.notify_low_stock
  if (kind === 'cash_session_closed') return s.notify_cash_close
  if (kind === 'daily_summary') return s.notify_daily_summary
  return true
}

const DAY_MS = 86_400_000

/** Sends what is pending. Old rows (> 24 h, e.g. before Telegram was set up) are dropped, not sent. */
export async function deliverPending(env: Env): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 }
  if (!env.SUPABASE_SECRET_KEY || !telegramConfigured(env)) return result
  const settings = await serverRpc<Settings>(env, 'server_notification_settings')
  if (!settings.telegram_chat_id) return result

  const pending = await serverRpc<Pending[]>(env, 'server_pending_notifications', { p_limit: 30 })
  for (const entry of pending) {
    const tooOld = Date.now() - new Date(entry.created_at).getTime() > DAY_MS
    if (tooOld || !wanted(entry.kind, settings)) {
      await serverRpc(env, 'server_mark_notification', { p_id: entry.id, p_ok: true })
      result.skipped++
      continue
    }
    try {
      await sendMessage(env, settings.telegram_chat_id, render(entry))
      await serverRpc(env, 'server_mark_notification', { p_id: entry.id, p_ok: true })
      result.sent++
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error'
      await serverRpc(env, 'server_mark_notification', { p_id: entry.id, p_ok: false, p_error: message })
      result.failed++
    }
  }
  return result
}

/** Every morning: fixed expenses of the day + yesterday's summary, then deliver. */
export async function runDaily(env: Env): Promise<void> {
  if (!env.SUPABASE_SECRET_KEY) return
  await serverRpc(env, 'server_daily_job', {})
  await deliverPending(env)
}

// ---------------------------------------------------------------------------
// Settings screen endpoints (owner only)
// ---------------------------------------------------------------------------
async function requireOwner(request: Request, env: Env, write: boolean) {
  if (write && !isSameOrigin(request)) return errorResponse(403, 'Origen no permitido')
  const session = await getStaffSession(request, env)
  if (!session) return errorResponse(401, 'Sesión no válida')
  if (session.role !== 'owner') return errorResponse(403, 'Solo el dueño puede configurar las notificaciones')
  return null
}

function handleError(error: unknown): Response {
  if (error instanceof ServerError) return errorResponse(error.status, error.message)
  throw error
}

/** GET /api/notifications/status — is the bot configured on the server, and which one. */
export async function notificationStatus(request: Request, env: Env): Promise<Response> {
  const denied = await requireOwner(request, env, false)
  if (denied) return denied
  if (!telegramConfigured(env)) return json({ telegram: false, server: Boolean(env.SUPABASE_SECRET_KEY) })
  try {
    return json({ telegram: true, server: Boolean(env.SUPABASE_SECRET_KEY), bot: await botUsername(env) })
  } catch (error) {
    return handleError(error)
  }
}

/** POST /api/notifications/chats — chats that wrote to the bot, to pick one. */
export async function discoverChats(request: Request, env: Env): Promise<Response> {
  const denied = await requireOwner(request, env, true)
  if (denied) return denied
  try {
    return json({ chats: await findChats(env) })
  } catch (error) {
    return handleError(error)
  }
}

/** POST /api/notifications/test { chat_id } — sends a test message. */
export async function sendTest(request: Request, env: Env): Promise<Response> {
  const denied = await requireOwner(request, env, true)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { chat_id?: string }
  if (!body.chat_id || !/^-?\d{3,20}$/.test(body.chat_id)) return errorResponse(400, 'Chat no válido')
  try {
    await sendMessage(
      env,
      body.chat_id,
      '✅ <b>Dosman</b>\nLas notificaciones quedaron conectadas. Aquí llegarán las alertas, los cierres de caja y el resumen del día.',
    )
    return json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
