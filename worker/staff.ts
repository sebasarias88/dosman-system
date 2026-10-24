import { getStaffSession } from './auth'
import type { Env } from './env'
import { errorResponse, isSameOrigin, json } from './http'
import { authAdmin, ServerError, serverRpc } from './server'

/*
 * Staff accounts. Only the owner may create or change them, and only here:
 * creating a login needs the Supabase secret key, which must never reach the
 * browser. The database functions (server_*) keep the business rules
 * (one active owner, waiters only where there are tables…) and the audit trail.
 */

const STAFF_EMAIL_DOMAIN = 'dosman.internal'
const ROLES = new Set(['owner', 'admin', 'cashier', 'waiter', 'kitchen'])
const USERNAME = /^[a-z0-9._-]{3,30}$/
// About 100 years: Supabase's way of blocking a login without deleting it.
const BLOCKED = '876000h'

/** PINs anyone would guess: 000000, 111111, 123456, 654321… */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true
  if (/^(\d)\1{5}$/.test(pin)) return true
  const digits = [...pin].map(Number)
  const steps = digits.slice(1).map((d, i) => d - (digits[i] ?? 0))
  return steps.every((s) => s === 1) || steps.every((s) => s === -1)
}

async function requireOwner(request: Request, env: Env) {
  if (!isSameOrigin(request)) return { error: errorResponse(403, 'Origen no permitido') }
  const session = await getStaffSession(request, env)
  if (!session) return { error: errorResponse(401, 'Sesión no válida') }
  if (session.role !== 'owner')
    return { error: errorResponse(403, 'Solo el dueño puede administrar empleados') }
  return { session }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function handleError(error: unknown): Response {
  if (error instanceof ServerError) return errorResponse(error.status, error.message)
  throw error
}

/** POST /api/staff { username, full_name, role, branch_id, pin } */
export async function createStaff(request: Request, env: Env): Promise<Response> {
  const auth = await requireOwner(request, env)
  if (auth.error) return auth.error
  const body = await readBody(request)
  if (!body) return errorResponse(400, 'Datos no válidos')

  const username = text(body.username).toLowerCase()
  const fullName = text(body.full_name)
  const role = text(body.role)
  const branchId = text(body.branch_id) || null
  const pin = text(body.pin)

  if (!USERNAME.test(username)) return errorResponse(400, 'El usuario no es válido')
  if (!ROLES.has(role)) return errorResponse(400, 'El rol no es válido')
  if (isWeakPin(pin)) return errorResponse(400, 'El PIN debe tener 6 números y no ser fácil de adivinar')

  try {
    const payload = { username, full_name: fullName, role, branch_id: branchId }
    await serverRpc(env, 'server_validate_new_staff', { payload })
    const user = await authAdmin<{ id: string }>(env, 'POST', 'users', {
      email: `${username}@${STAFF_EMAIL_DOMAIN}`,
      password: pin,
      email_confirm: true,
      // app_metadata can only be written with the secret key: the trigger that
      // creates the profile trusts it for the role and branch.
      app_metadata: { role, branch_id: branchId },
      user_metadata: { full_name: fullName },
    })
    await serverRpc(env, 'server_staff_created', { p_actor: auth.session.userId, p_profile_id: user.id })
    return json({ id: user.id }, { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}

/** PATCH /api/staff/:id { full_name?, role?, branch_id?, is_active?, pin? } */
export async function updateStaff(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireOwner(request, env)
  if (auth.error) return auth.error
  if (!/^[0-9a-f-]{36}$/.test(id)) return errorResponse(400, 'Empleado no válido')
  const body = await readBody(request)
  if (!body) return errorResponse(400, 'Datos no válidos')

  const pin = text(body.pin)
  if (pin && isWeakPin(pin))
    return errorResponse(400, 'El PIN debe tener 6 números y no ser fácil de adivinar')
  if (body.role !== undefined && !ROLES.has(text(body.role))) return errorResponse(400, 'El rol no es válido')

  const payload: Record<string, unknown> = { id, pin_changed: Boolean(pin) }
  if (body.full_name !== undefined) payload.full_name = text(body.full_name)
  if (body.role !== undefined) payload.role = text(body.role)
  if (body.branch_id !== undefined) payload.branch_id = text(body.branch_id) || null
  if (typeof body.is_active === 'boolean') payload.is_active = body.is_active

  try {
    // Rules and profile first: if they fail, the login is left untouched.
    const profile = await serverRpc<{
      role: string
      branch_id: string | null
      is_active: boolean
      full_name: string
    }>(env, 'server_update_staff', { p_actor: auth.session.userId, payload })
    await authAdmin(env, 'PUT', `users/${id}`, {
      ...(pin ? { password: pin } : {}),
      app_metadata: { role: profile.role, branch_id: profile.branch_id },
      user_metadata: { full_name: profile.full_name },
      // A disabled employee can't sign in; their data and history stay.
      ban_duration: profile.is_active ? 'none' : BLOCKED,
    })
    return json(profile)
  } catch (error) {
    return handleError(error)
  }
}
