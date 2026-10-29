import { getStaffSession, UserRpcError, userRpc, type StaffSession } from '../auth'
import type { Env } from '../env'
import { errorResponse, isSameOrigin, json } from '../http'
import { manualFor } from './manual'

/*
 * Help assistant ("Ayuda"). Answers how to use the system with the manual of
 * the person's role. Runs on Cloudflare Workers AI: no extra account or key,
 * free daily allowance, and questions are not used to train models.
 * Only a counter per person and day is stored (daily limit), never the text.
 */

// Gemma 4 handles Spanish well and is cheap: a question costs ~50 neurons,
// so the free 10,000 per day are a few hundred questions.
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'
const FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
const MAX_MESSAGES = 10
const MAX_CHARS = 800

const ROLE_NAMES: Record<string, string> = {
  owner: 'dueño',
  admin: 'administrador',
  cashier: 'cajero(a)',
  waiter: 'mesero(a)',
  kitchen: 'preparación (cocina/barra)',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface BranchInfo {
  name: string
  is_main: boolean
  uses_waiters: boolean
  takes_delivery: boolean
}

function systemPrompt(session: StaffSession, branch: BranchInfo | null, screen: string): string {
  const where = branch
    ? `${branch.name} (${branch.is_main ? 'sede principal: compra y envía mercancía' : 'sede que recibe mercancía, no compra'}; ${branch.uses_waiters ? 'con mesas y meseros' : 'sin mesas'}; ${branch.takes_delivery ? 'con domicilios' : 'sin domicilios'})`
    : 'todas las sedes'
  return `Eres "Ayuda", el asistente del sistema de ventas, caja e inventario de Dosman Cholao & Coffee.
Hablas con ${session.fullName}, rol ${ROLE_NAMES[session.role] ?? session.role}, en ${where}. Ahora está en la pantalla: ${screen || 'desconocida'}.

Reglas:
- Responde SOLO sobre cómo usar este sistema y la operación diaria del negocio, usando ÚNICAMENTE el manual de abajo.
- Si el manual no lo dice, no inventes: di que no lo sabes y que le pregunte al dueño. Nunca inventes botones, pantallas ni funciones.
- Si lo que pide no está permitido para su rol, explícale con amabilidad que eso lo hace el dueño o el administrador.
- Responde en español de Colombia, tuteando con "tú" (toca, escribe, recuerda, completa). Nunca uses el voseo (tocá, escribí, recordá, completá). Frases cortas y claras para alguien que no sabe de tecnología.
- Para explicar cómo hacer algo usa pasos numerados y escribe los nombres de pantallas y botones en **negrita**, tal como aparecen.
- Máximo unas 8 líneas, salvo que pidan más detalle.
- Tú no puedes hacer cambios en el sistema ni ver datos (ventas, saldos, inventario): solo explicas cómo hacerlo.
- Nunca pidas ni repitas PINs o contraseñas.
- Si preguntan algo que no tiene que ver con el negocio o el sistema, di amablemente que solo ayudas con el sistema.
- Errores de dinero (faltantes, cobros equivocados): explica cómo se anula o registra y recomienda avisarle al dueño.

MANUAL
${manualFor(session.role)}`
}

function readMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object') return null
  const list = (body as { messages?: unknown }).messages
  if (!Array.isArray(list) || list.length === 0) return null
  const messages: ChatMessage[] = []
  for (const item of list.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') return null
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const text = content.trim().slice(0, MAX_CHARS)
    if (text) messages.push({ role, content: text })
  }
  // The conversation must end with the person's question.
  return messages.at(-1)?.role === 'user' ? messages : null
}

async function loadBranch(env: Env, session: StaffSession, branchId: unknown): Promise<BranchInfo | null> {
  const id = typeof branchId === 'string' && /^[0-9a-f-]{36}$/.test(branchId) ? branchId : session.branchId
  if (!id) return null
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/branches`)
  url.searchParams.set('id', `eq.${id}`)
  url.searchParams.set('select', 'name,is_main,uses_waiters,takes_delivery')
  const response = await fetch(url, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.token}` },
  })
  if (!response.ok) return null
  const [branch] = (await response.json()) as BranchInfo[]
  return branch ?? null
}

/** Text of a Workers AI answer (models return either `response` or OpenAI-style `choices`). */
function answerText(result: unknown): string {
  const r = result as { response?: unknown; choices?: { message?: { content?: unknown } }[] }
  const raw =
    typeof r.response === 'string'
      ? r.response
      : typeof r.choices?.[0]?.message?.content === 'string'
        ? r.choices[0].message.content
        : ''
  // Some models write their reasoning between <think> tags: never show it.
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

async function ask(env: Env, messages: { role: string; content: string }[]): Promise<string> {
  if (!env.AI) throw new Error('AI binding missing')
  const models = [env.ASSISTANT_MODEL ?? DEFAULT_MODEL, FALLBACK_MODEL]
  let lastError: unknown
  for (const model of models) {
    try {
      const result = await env.AI.run(
        model as Parameters<Ai['run']>[0],
        {
          messages,
          max_tokens: 700,
          temperature: 0.2,
        } as never,
      )
      const text = answerText(result)
      if (text) return text
    } catch (error) {
      lastError = error
      console.error('Assistant model failed', model, error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Empty answer')
}

/** POST /api/assistant { messages: [{ role, content }], screen, branch_id } */
export async function assistant(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request)) return errorResponse(403, 'Origen no permitido')
  const session = await getStaffSession(request, env)
  if (!session) return errorResponse(401, 'Sesión no válida')
  if (!env.AI && env.ASSISTANT_FAKE !== 'on') {
    return errorResponse(503, 'El asistente todavía no está activado en el servidor')
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const messages = readMessages(body)
  if (!messages) return errorResponse(400, 'Escribe tu pregunta')
  const screen = typeof body?.screen === 'string' ? body.screen.slice(0, 60) : ''

  let remaining: number
  try {
    remaining = await userRpc<number>(env, session, 'assistant_take_quota')
  } catch (error) {
    if (error instanceof UserRpcError) return errorResponse(429, error.message)
    throw error
  }

  const branch = await loadBranch(env, session, body?.branch_id)
  const prompt = systemPrompt(session, branch, screen)

  if (env.ASSISTANT_FAKE === 'on') {
    // Local tests: proves the prompt was built for the right person and role.
    const question = messages.at(-1)?.content ?? ''
    return json({
      reply: `Respuesta de prueba para **${ROLE_NAMES[session.role]}** en ${branch?.name ?? 'todas las sedes'} (pantalla ${screen}).\n1. Pregunta: ${question}\n2. Manual con ${prompt.split('\n## ').length - 1} secciones.`,
      remaining,
    })
  }

  try {
    const reply = await ask(env, [{ role: 'system', content: prompt }, ...messages])
    return json({ reply, remaining })
  } catch {
    return errorResponse(502, 'El asistente no pudo responder ahora. Intenta de nuevo en un momento.')
  }
}
