import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'icon'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface-3 text-fg hover:bg-line-strong',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-ink hover:brightness-110',
}

// Touch-first sizes: 44px minimum, 56px for the main actions on the POS.
const SIZES: Record<Size, string> = {
  md: 'h-11 px-4 text-sm',
  lg: 'h-14 px-6 text-base',
  icon: 'h-11 w-11',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium',
        'transition-[background-color,filter,transform] duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none',
        // While loading the button stays fully visible (only blocked) so the spinner reads as "working".
        loading ? 'cursor-progress' : 'disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          {/* The label stays in place (invisible) so the button keeps its width. */}
          <span className="invisible inline-flex items-center gap-2" aria-hidden>
            {children}
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner className="size-5" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
