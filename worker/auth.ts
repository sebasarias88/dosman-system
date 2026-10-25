import type { Env } from './env'

export type AppRole = 'owner' | 'admin' | 'cashier' | 'waiter' | 'kitchen'

export interface StaffSession {
  userId: string
  role: AppRole
  branchId: string | null
  fullName: string
  /** The user's own access token, to call the database AS the user (RLS applies). */
  token: string
}

interface ProfileRow {
  role: AppRole
  branch_id: string | null
  is_active: boolean
  full_name: string
}

/**
 * Validates the Supabase access token sent by the app and loads the staff profile.
 *
 * Why no service key: we ask Supabase "who is this token?" and then read the
 * profile with the user's own token, so Row Level Security still applies.
 * The Worker never holds a key that could bypass the database rules.
 */
export async function getStaffSession(request: Request, env: Env): Promise<StaffSession | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null

  const supabaseHeaders = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${token}`,
  }

  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders })
  if (!userResponse.ok) return null
  const user = (await userResponse.json()) as { id?: string }
  if (!user.id) return null

  const profileUrl = new URL(`${env.SUPABASE_URL}/rest/v1/profiles`)
  profileUrl.searchParams.set('id', `eq.${user.id}`)
  profileUrl.searchParams.set('select', 'role,branch_id,is_active,full_name')
  const profileResponse = await fetch(profileUrl, { headers: supabaseHeaders })
  if (!profileResponse.ok) return null
  const [profile] = (await profileResponse.json()) as ProfileRow[]
  if (!profile || !profile.is_active) return null

  return {
    userId: user.id,
    role: profile.role,
    branchId: profile.branch_id,
    fullName: profile.full_name,
    token,
  }
}

export function isManager(session: StaffSession): boolean {
  return session.role === 'owner' || session.role === 'admin'
}

/** Calls a database function as the signed-in user (their rules and limits apply). */
export async function userRpc<T>(env: Env, session: StaffSession, fn: string, args: object = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = `Error ${response.status}`
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message
    } catch {
      // Keep the generic message.
    }
    throw new UserRpcError(message, response.status)
  }
  return (text ? JSON.parse(text) : null) as T
}

export class UserRpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
