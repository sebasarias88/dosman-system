import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

export interface SelectOption {
  value: string
  label: string
  /** Second line in the list (e.g. the unit of a supply). Not shown on the closed control. */
  hint?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Shown when no option matches the value (e.g. "Elegir…"). */
  placeholder?: string
  /** Show a search box. By default it appears when there are more than 8 options. */
  searchable?: boolean
  disabled?: boolean
  /** The options are still loading: shows a spinner and waits. */
  loading?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

const MAX_LIST_HEIGHT = 320
const GAP = 6

/** Lowercase without accents, so "cafe" finds "Café". */
function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Dropdown that replaces the native <select> (which looks different on every
 * device). The list lives in the browser's top layer (Popover API), so it is
 * never clipped by a side panel or hidden behind an open dialog.
 * Keyboard: arrows, Home/End, Enter, Escape and type-to-jump.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Elegir…',
  searchable,
  disabled,
  loading,
  className,
  id,
  ...aria
}: SelectProps) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)

  const withSearch = searchable ?? options.length > 8
  const selected = options.find((o) => o.value === value)

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return options
    return options.filter((o) => normalize(`${o.label} ${o.hint ?? ''}`).includes(q))
  }, [options, query])

  function firstEnabled(from: number, step: 1 | -1) {
    for (let i = from; i >= 0 && i < visible.length; i += step) {
      if (!visible[i]?.disabled) return i
    }
    return -1
  }

  function show() {
    if (disabled || loading) return
    setQuery('')
    const current = options.findIndex((o) => o.value === value)
    setActive(current >= 0 && !options[current]?.disabled ? current : firstEnabledIn(options))
    setOpen(true)
  }

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function choose(option: SelectOption | undefined) {
    if (!option || option.disabled) return
    if (option.value !== value) onValueChange(option.value)
    close()
  }

  // Place the list under the control (or above it when there is no room) and
  // keep it attached while the page or the side panel scrolls.
  useLayoutEffect(() => {
    if (!open) return
    const popover = popoverRef.current
    const trigger = triggerRef.current
    if (!popover || !trigger) return
    if (typeof popover.showPopover === 'function' && !popover.matches(':popover-open')) popover.showPopover()

    function place() {
      if (!popover || !trigger) return
      const rect = trigger.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - GAP - 8
      const above = rect.top - GAP - 8
      const wanted = Math.min(popover.scrollHeight, MAX_LIST_HEIGHT)
      const up = below < Math.min(wanted, 220) && above > below
      const width = Math.max(rect.width, 192)
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
      popover.style.left = `${left}px`
      popover.style.width = `${width}px`
      popover.style.maxHeight = `${Math.max(Math.min(MAX_LIST_HEIGHT, up ? above : below), 120)}px`
      popover.style.top = up ? '' : `${rect.bottom + GAP}px`
      popover.style.bottom = up ? `${window.innerHeight - rect.top + GAP}px` : ''
    }

    place()
    ;(withSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, withSearch])

  // A tap outside closes the list without stealing the focus.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      show()
    }
  }

  function onListKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        const next = firstEnabled(active + 1, 1)
        if (next >= 0) setActive(next)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        const prev = firstEnabled(active - 1, -1)
        if (prev >= 0) setActive(prev)
        break
      }
      case 'Home':
        if (withSearch) break
        event.preventDefault()
        setActive(firstEnabled(0, 1))
        break
      case 'End':
        if (withSearch) break
        event.preventDefault()
        setActive(firstEnabled(visible.length - 1, -1))
        break
      case 'Enter':
        event.preventDefault()
        choose(visible[active])
        break
      case 'Escape':
        // Without preventDefault the open side panel would close too.
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        close(false)
        break
      default:
        if (!withSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          // Type to jump: "m" goes to the first option starting with M.
          const now = event.timeStamp
          typed.current.text = (now - typed.current.at > 700 ? '' : typed.current.text) + normalize(event.key)
          typed.current.at = now
          const match = visible.findIndex(
            (o) => !o.disabled && normalize(o.label).startsWith(typed.current.text),
          )
          if (match >= 0) setActive(match)
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        aria-invalid={aria['aria-invalid']}
        aria-describedby={aria['aria-describedby']}
        aria-busy={loading || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface-2 pr-3 pl-3.5 text-left text-[0.95rem]',
          'transition-colors hover:border-line-strong aria-invalid:border-danger disabled:opacity-50',
          open && 'border-fg-subtle',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-fg-subtle')}>
          {selected?.label ?? (loading ? 'Cargando…' : placeholder)}
        </span>
        {loading ? (
          <Spinner className="size-4 shrink-0 text-fg-subtle" />
        ) : (
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-fg-subtle transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          onKeyDown={onListKeyDown}
          className="fixed inset-auto m-0 flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface-3 p-0 text-fg shadow-2xl shadow-black/50"
        >
          {withSearch && (
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search aria-hidden className="size-4 shrink-0 text-fg-subtle" />
              <input
                ref={searchRef}
                type="text"
                role="searchbox"
                aria-label="Buscar"
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                placeholder="Buscar…"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                className="h-11 min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={aria['aria-label']}
            aria-activedescendant={!withSearch && active >= 0 ? `${listId}-${active}` : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none"
          >
            {visible.length === 0 && <p className="px-3 py-3 text-sm text-fg-subtle">Sin resultados</p>}
            {visible.map((option, index) => {
              const isSelected = option.value === value
              return (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onPointerMove={() => !option.disabled && active !== index && setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.95rem]',
                    index === active && 'bg-surface-2',
                    option.disabled && 'cursor-not-allowed text-fg-subtle',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{option.label}</span>
                    {option.hint && <span className="block text-xs text-fg-subtle">{option.hint}</span>}
                  </span>
                  {isSelected && <Check aria-hidden className="size-4 shrink-0" />}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function firstEnabledIn(options: SelectOption[]) {
  return options.findIndex((o) => !o.disabled)
}
