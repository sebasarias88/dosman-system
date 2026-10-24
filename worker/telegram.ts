import type { Env } from './env'
import { ServerError } from './server'

/*
 * Telegram Bot API: free, no phone number needed and no risk of the account
 * being blocked like an unofficial WhatsApp sender. The owner creates a bot
 * with @BotFather, sends it any message (or adds it to the owners' group) and
 * the settings screen finds the chat.
 */

const DEFAULT_API = 'https://api.telegram.org'

function token(env: Env): string {
  if (!env.TELEGRAM_BOT_TOKEN)
    throw new ServerError('Falta configurar el bot de Telegram en el servidor', 503)
  return env.TELEGRAM_BOT_TOKEN
}

export const telegramConfigured = (env: Env) => Boolean(env.TELEGRAM_BOT_TOKEN)

interface TelegramResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

async function call<T>(env: Env, method: string, body?: unknown): Promise<T> {
  // TELEGRAM_API_URL only exists in local tests (a fake Telegram); production uses the real one.
  const response = await fetch(`${env.TELEGRAM_API_URL ?? DEFAULT_API}/bot${token(env)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse<T>
  if (!data.ok || data.result === undefined) {
    throw new ServerError(`Telegram: ${data.description ?? `error ${response.status}`}`, 502)
  }
  return data.result
}

/** Escapes text for Telegram's HTML mode. */
export function html(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function sendMessage(env: Env, chatId: string, text: string): Promise<void> {
  await call(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
}

export interface FoundChat {
  id: string
  title: string
  type: string
}

interface Update {
  message?: { chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string } }
  my_chat_member?: { chat: { id: number; type: string; title?: string } }
}

/** Chats that wrote to the bot recently (Telegram keeps updates for 24 hours). */
export async function findChats(env: Env): Promise<FoundChat[]> {
  const bot = await call<{ username: string }>(env, 'getMe')
  const updates = await call<Update[]>(env, 'getUpdates', { allowed_updates: ['message', 'my_chat_member'] })
  const chats = new Map<string, FoundChat>()
  for (const update of updates) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat
    if (!chat) continue
    const title =
      'title' in chat && chat.title
        ? chat.title
        : [update.message?.chat.first_name, update.message?.chat.last_name].filter(Boolean).join(' ') ||
          'Chat'
    chats.set(String(chat.id), { id: String(chat.id), title, type: chat.type })
  }
  return [...chats.values()].map((c) => ({ ...c, title: c.title || `@${bot.username}` }))
}

export async function botUsername(env: Env): Promise<string> {
  return (await call<{ username: string }>(env, 'getMe')).username
}
