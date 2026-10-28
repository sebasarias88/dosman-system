import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const CONTROL =
  'w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[0.95rem] text-fg placeholder:text-fg-subtle ' +
  'transition-colors hover:border-line-strong focus:border-fg-subtle aria-invalid:border-danger disabled:opacity-50'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string
  className?: string
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const describedBy = error || hint ? `${id}-desc` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm text-fg-muted">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {(error || hint) && (
        <p id={describedBy} className={cn('text-xs', error ? 'text-danger' : 'text-fg-subtle')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, 'h-11', className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'min-h-20 resize-y py-2.5', className)} {...props} />
}

const pesoFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onValueChange: (value: number | null) => void
}

/** Whole pesos with thousands separators while typing: 12000 -> "12.000". */
export function MoneyInput({ value, onValueChange, className, ...props }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle">$</span>
      <input
        inputMode="numeric"
        autoComplete="off"
        className={cn(CONTROL, 'h-11 pl-7 tabular-nums', className)}
        value={value === null ? '' : pesoFormatter.format(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '')
          onValueChange(digits === '' ? null : Math.min(Number(digits), 99_999_999))
        }}
        {...props}
      />
    </div>
  )
}

interface QuantityInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  value: number | null
  onValueChange: (value: number | null) => void
  suffix?: string
}

/** Decimal quantity that accepts a comma (Colombian keyboards) or a dot. */
export function QuantityInput({ value, onValueChange, suffix, className, ...props }: QuantityInputProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value).replace('.', ','))
  const [lastValue, setLastValue] = useState(value)

  // Keep the text in sync when the value changes from outside (e.g. form reset).
  if (value !== lastValue) {
    setLastValue(value)
    const current = Number(draft.replace(',', '.'))
    if (value === null ? draft !== '' : current !== value)
      setDraft(value === null ? '' : String(value).replace('.', ','))
  }

  return (
    <div className="relative">
      <input
        inputMode="decimal"
        autoComplete="off"
        className={cn(CONTROL, 'h-11 tabular-nums', suffix && 'pr-12', className)}
        value={draft}
        onChange={(e) => {
          const text = e.target.value.replace(/[^\d.,]/g, '')
          setDraft(text)
          const parsed = Number(text.replace(',', '.'))
          const next = text === '' || Number.isNaN(parsed) ? null : parsed
          setLastValue(next)
          onValueChange(next)
        }}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-fg-subtle">
          {suffix}
        </span>
      )}
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description?: string
  /** The change is being saved: shows a spinner in the knob and blocks new taps. */
  loading?: boolean
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, label, description, loading, disabled }: SwitchProps) {
  const blocked = Boolean(loading || disabled)
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3',
        blocked ? 'cursor-default' : 'cursor-pointer',
        disabled && !loading && 'opacity-50',
      )}
    >
      <span>
        <span className="block text-[0.95rem]">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={blocked}
        aria-busy={loading || undefined}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          checked ? 'bg-success' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-fg transition-transform',
            checked && 'translate-x-5',
          )}
        >
          {loading && (
            <span className="size-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          )}
        </span>
      </span>
    </label>
  )
}
