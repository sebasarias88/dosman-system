import { useMutation } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { Bot, Send, Sparkles } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { MODULES } from '@/config/modules'
import { useStaff } from '@/features/auth/use-staff'
import { cn } from '@/lib/cn'
import { askAssistant, SUGGESTIONS, type ChatMessage } from './assistant-api'

/** **bold** inside a line, without ever rendering HTML from the model. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

/** Minimal Markdown: paragraphs, numbered and bulleted lists, bold. */
function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag
        key={blocks.length}
        className={cn('flex flex-col gap-1 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}
      >
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    )
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    if (ordered?.[1] !== undefined || bullet?.[1] !== undefined) {
      const isOrdered = Boolean(ordered)
      if (list && list.ordered !== isOrdered) flush()
      list ??= { ordered: isOrdered, items: [] }
      list.items.push((ordered?.[1] ?? bullet?.[1] ?? '').trim())
      continue
    }
    flush()
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>)
  }
  flush()
  return <div className="flex flex-col gap-2">{blocks}</div>
}

/** Name of the screen the person is on, so "how do I do this here?" makes sense. */
function useScreenName(): string {
  const path = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
  const module = MODULES.find((m) => (m.path === '/' ? path === '/' : path.startsWith(m.path)))
  return module?.label ?? path
}

export function HelpChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, activeBranch } = useStaff()
  const screen = useScreenName()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: askAssistant,
    onSuccess: ({ reply, remaining: left }) => {
      setMessages((current) => [...current, { role: 'assistant', content: reply }])
      setRemaining(left)
    },
    onError: (error, input) => {
      // The question goes back to the box so it can be sent again.
      setMessages(input.messages.slice(0, -1))
      setDraft(input.messages.at(-1)?.content ?? '')
      setFailure(error instanceof Error ? error.message : 'No pude responder ahora.')
    },
  })

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, ask.isPending])

  function send(text: string) {
    const question = text.trim()
    if (!question || ask.isPending) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setDraft('')
    setFailure(null)
    ask.mutate({ messages: next, screen, branchId: activeBranch?.id ?? null })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    send(draft)
  }

  const suggestions = SUGGESTIONS[profile.role] ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ayuda"
      description="Pregunta cómo hacer algo en el sistema."
      footer={
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              aria-label="Tu pregunta"
              rows={2}
              maxLength={800}
              placeholder="Escribe tu pregunta…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(draft)
                }
              }}
              className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[0.95rem] placeholder:text-fg-subtle focus:border-fg-subtle"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Enviar pregunta"
              disabled={!draft.trim()}
              loading={ask.isPending}
            >
              <Send className="size-4" aria-hidden />
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            Es una inteligencia artificial y puede equivocarse. Si es algo de dinero, confírmalo con el dueño.
            {remaining !== null && ` · Te quedan ${remaining} preguntas hoy.`}
          </p>
        </form>
      }
    >
      <div className="flex flex-col gap-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-4 text-sm">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-chart" aria-hidden />
              <p>
                Hola, {profile.full_name.split(' ')[0]}. Pregúntame cómo hacer cualquier cosa en el sistema:
                cómo cobrar, anular, registrar una merma, dónde está cada pantalla…
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <p
              key={index}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-fg"
            >
              {message.content}
            </p>
          ) : (
            <div
              key={index}
              className="flex max-w-[92%] items-start gap-2.5 self-start text-sm leading-relaxed text-fg-muted"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3" aria-hidden>
                <Bot className="size-4" />
              </span>
              <div className="rounded-2xl rounded-tl-md bg-surface-2 px-4 py-3">
                <Answer text={message.content} />
              </div>
            </div>
          ),
        )}
        {failure && <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">{failure}</p>}
        {ask.isPending && (
          <div className="flex items-center gap-2.5 text-sm text-fg-subtle">
            <span className="grid size-7 place-items-center rounded-full bg-surface-3" aria-hidden>
              <Bot className="size-4" />
            </span>
            Pensando…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </Sheet>
  )
}
