import type { Env } from './env'

/** Thrown when the server key is missing or Supabase answers with an error. */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message)
  }
}

function secret(env: Env): string {
  if (!env.SUPABASE_SECRET_KEY) {
    throw new ServerError('Falta configurar la clave secreta de Supabase en el servidor', 503)
  }
  return env.SUPABASE_SECRET_KEY
}

/** Database errors raised by our functions already carry a Spanish message. */
async function readSupabaseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; msg?: string; error_description?: string }
    return body.message ?? body.msg ?? body.error_description ?? `Error ${response.status}`
  } catch {
    return `Error ${response.status}`
  }
}

/**
 * Calls a database function with the secret key. The key goes only in the
 * `apikey` header (Supabase rule for the new keys); the gateway turns it into
 * a service_role request.
 */
export async function serverRpc<T>(env: Env, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: secret(env), 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new ServerError(await readSupabaseError(response), response.status === 404 ? 500 : 400)
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

/** Supabase Auth admin API (create users, change PIN, block access). */
export async function authAdmin<T>(
  env: Env,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: secret(env), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const message = await readSupabaseError(response)
    if (/already (been )?registered|already exists/i.test(message)) {
      throw new ServerError('Ese usuario ya existe', 409)
    }
    throw new ServerError(message, 400)
  }
  return (await response.json()) as T
}
