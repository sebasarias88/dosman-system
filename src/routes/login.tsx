import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Delete } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import {
  normalizeUsername,
  PIN_LENGTH,
  signIn,
  staffContextQuery,
  USERNAME_PATTERN,
} from '@/features/auth/auth-api'
import { cn } from '@/lib/cn'

/** Only same-app paths are accepted, so the link can't send people to another site. */
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: safeRedirect(search.redirect) }),
  beforeLoad: async ({ context }) => {
    const staff = await context.queryClient.ensureQueryData(staffContextQuery)
    if (staff) throw redirect({ to: '/' })
  },
  component: LoginScreen,
})

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function LoginScreen() {
  const { redirect: redirectTo } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  const usernameValid = USERNAME_PATTERN.test(normalizeUsername(username))

  async function submit(currentPin: string) {
    if (!usernameValid) {
      setError('Escribe tu usuario')
      usernameRef.current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await signIn(username, currentPin)
      const staff = await queryClient.fetchQuery({ ...staffContextQuery, staleTime: 0 })
      if (!staff) {
        setError('Tu usuario está desactivado. Habla con el administrador.')
        setPin('')
        return
      }
      await navigate({ to: redirectTo ?? '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ingresar')
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  function pressDigit(digit: string) {
    if (submitting || pin.length >= PIN_LENGTH) return
    const next = pin + digit
    setPin(next)
    setError(null)
    if (next.length === PIN_LENGTH) void submit(next)
  }

  function backspace() {
    setPin((value) => value.slice(0, -1))
  }

  // Physical keyboard support for the PC: digits and backspace fill the PIN
  // while the username field is not focused.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.activeElement === usernameRef.current) return
      if (/^\d$/.test(event.key)) pressDigit(event.key)
      else if (event.key === 'Backspace') backspace()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function handleUsernameSubmit(event: FormEvent) {
    event.preventDefault()
    usernameRef.current?.blur()
  }

  return (
    <main className="grid min-h-full place-items-center bg-ink p-6">
      <div className="w-full max-w-sm">
        <Logo variant="vertical" className="mx-auto w-44 text-fg" />

        <form onSubmit={handleUsernameSubmit} className="mt-10">
          <label htmlFor="username" className="mb-2 block text-sm text-fg-muted">
            Usuario
          </label>
          <input
            ref={usernameRef}
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setError(null)
            }}
            className="h-14 w-full rounded-xl border border-line bg-surface px-4 text-lg placeholder:text-fg-subtle"
            placeholder="ej. maria"
          />
        </form>

        <p className="mt-8 mb-3 text-center text-sm text-fg-muted" id="pin-label">
          PIN de {PIN_LENGTH} dígitos
        </p>
        <div className="flex justify-center gap-3" role="group" aria-labelledby="pin-label">
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-4 rounded-full border transition-colors',
                i < pin.length ? 'border-fg bg-fg' : 'border-line-strong',
              )}
            />
          ))}
        </div>

        <p role="alert" className="mt-4 min-h-6 text-center text-sm text-danger">
          {error}
        </p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          {KEYPAD.map((digit) => (
            <Keypad key={digit} label={digit} onPress={() => pressDigit(digit)} disabled={submitting} />
          ))}
          <span />
          <Keypad label="0" onPress={() => pressDigit('0')} disabled={submitting} />
          <Button
            variant="ghost"
            className="h-16 rounded-2xl"
            aria-label="Borrar dígito"
            onClick={backspace}
            disabled={submitting || pin.length === 0}
          >
            <Delete className="size-6" aria-hidden />
          </Button>
        </div>

        {submitting && <p className="mt-6 text-center text-sm text-fg-muted">Ingresando…</p>}
      </div>
    </main>
  )
}

function Keypad({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Button
      variant="secondary"
      className="h-16 rounded-2xl text-2xl font-normal"
      onClick={onPress}
      disabled={disabled}
    >
      {label}
    </Button>
  )
}
