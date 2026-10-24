import { supabase } from './supabase'

/** Header with the signed-in user's token, for our own Worker endpoints (/api/*). */
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Tu sesión expiró. Vuelve a ingresar.')
  return { authorization: `Bearer ${token}` }
}

/** The Worker answers errors as { error: "mensaje en español" }. */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

/** JSON call to the Worker with the session token. Throws an Error with a readable message. */
export async function apiJson<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!navigator.onLine) throw new Error('Sin conexión a internet. Intenta de nuevo cuando vuelva.')
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(await authHeader()),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) throw new Error(await readApiError(response, 'No se pudo completar la operación.'))
  return (await response.json()) as T
}
