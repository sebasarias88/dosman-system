import { useQueryClient } from '@tanstack/react-query'
import { Link, useMatches, useNavigate } from '@tanstack/react-router'
import { CircleHelp, LogOut, Menu, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { MODULE_GROUP_LABELS, modulesFor, type ModuleGroup } from '@/config/modules'
import { setActiveBranchId } from '@/features/auth/active-branch'
import { signOut } from '@/features/auth/auth-api'
import { HelpChat } from '@/features/assistant/help-chat'
import { useStaff } from '@/features/auth/use-staff'
import { cn } from '@/lib/cn'
import { ROLE_LABELS } from '@/types/app'

const GROUP_ORDER: ModuleGroup[] = ['operation', 'stock', 'management']

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, activeBranch } = useStaff()
  const visible = modulesFor(profile.role, activeBranch)

  return (
    <nav aria-label="Módulos" className="flex flex-col gap-6">
      {GROUP_ORDER.map((group) => {
        const items = visible.filter((m) => m.group === group)
        if (items.length === 0) return null
        return (
          <div key={group}>
            <p className="mb-2 px-3 text-xs font-medium tracking-[0.14em] text-fg-subtle uppercase">
              {MODULE_GROUP_LABELS[group]}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map(({ key, path, label, icon: Icon }) => (
                <li key={key}>
                  <Link
                    to={path}
                    onClick={onNavigate}
                    activeOptions={{ exact: path === '/' }}
                    className="flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                    activeProps={{ className: 'bg-surface-3! text-fg!' }}
                  >
                    <Icon className="size-[1.15rem] shrink-0" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function BranchSwitcher() {
  const { branches, activeBranch } = useStaff()
  const id = useId()
  if (!activeBranch) return null

  if (branches.length < 2) {
    return (
      <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
        <span className="block text-xs text-fg-subtle">Sede</span>
        {activeBranch.name}
      </p>
    )
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block px-1 text-xs text-fg-subtle">
        Sede
      </label>
      <Select
        id={id}
        className="text-sm"
        value={activeBranch.id}
        onValueChange={setActiveBranchId}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
      />
    </div>
  )
}

function UserCard() {
  const { profile } = useStaff()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      queryClient.clear()
      await navigate({ to: '/login', search: { redirect: undefined } })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-fg">
        {profile.full_name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{profile.full_name}</p>
        <p className="text-xs text-fg-subtle">{ROLE_LABELS[profile.role]}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Cerrar sesión"
        loading={signingOut}
        onClick={() => void handleSignOut()}
      >
        <LogOut className="size-5" aria-hidden />
      </Button>
    </div>
  )
}

function SidebarContent({ onNavigate, onHelp }: { onNavigate?: () => void; onHelp: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo className="mx-2 mt-2 w-40 text-fg" />
      <BranchSwitcher />
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <Navigation onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onHelp}
          className="flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <CircleHelp className="size-[1.15rem] shrink-0" aria-hidden />
          Ayuda
        </button>
        <UserCard />
      </div>
    </div>
  )
}

/** Icon-only rail used on full-screen work modules (POS, tables) to leave room for the content. */
function CompactRail({ onOpenMenu, onHelp }: { onOpenMenu: () => void; onHelp: () => void }) {
  const { profile, activeBranch } = useStaff()
  const visible = modulesFor(profile.role, activeBranch)

  return (
    <aside className="hidden w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 lg:flex">
      <Button variant="ghost" size="icon" aria-label="Abrir menú" onClick={onOpenMenu}>
        <Menu className="size-6" aria-hidden />
      </Button>
      <Logo variant="isotype" className="my-3 w-7 text-fg" />
      <nav aria-label="Módulos" className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
        {visible.map(({ key, path, label, icon: Icon }) => (
          <Link
            key={key}
            to={path}
            aria-label={label}
            title={label}
            activeOptions={{ exact: path === '/' }}
            className="grid size-11 place-items-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            activeProps={{ className: 'bg-surface-3! text-fg!' }}
          >
            <Icon className="size-5" aria-hidden />
          </Link>
        ))}
      </nav>
      <Button variant="ghost" size="icon" aria-label="Ayuda" title="Ayuda" onClick={onHelp}>
        <CircleHelp className="size-5" aria-hidden />
      </Button>
    </aside>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const openHelp = () => {
    setMenuOpen(false)
    setHelpOpen(true)
  }
  const compact = useMatches({ select: (matches) => matches.some((m) => m.staticData.compactShell) })

  return (
    <div className="flex h-full">
      {compact ? (
        <CompactRail onOpenMenu={() => setMenuOpen(true)} onHelp={openHelp} />
      ) : (
        /* PC and large tablets: fixed sidebar. */
        <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block">
          <SidebarContent onHelp={openHelp} />
        </aside>
      )}

      {/* Phones and small tablets: top bar + drawer. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-3 lg:hidden">
          <Button variant="ghost" size="icon" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
            <Menu className="size-6" aria-hidden />
          </Button>
          <Logo className="w-28 text-fg" />
          <Button variant="ghost" size="icon" aria-label="Ayuda" onClick={openHelp}>
            <CircleHelp className="size-6" aria-hidden />
          </Button>
        </header>

        <main className={cn('min-h-0 flex-1', compact ? 'overflow-hidden' : 'overflow-y-auto')}>
          {children}
        </main>
      </div>

      <div
        className={cn(
          'fixed inset-0 z-30 bg-ink/70 transition-opacity',
          !compact && 'lg:hidden',
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[min(18rem,85vw)] border-r border-line bg-surface transition-transform',
          !compact && 'lg:hidden',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Cerrar menú"
          className="absolute top-3 right-3"
          onClick={() => setMenuOpen(false)}
        >
          <X className="size-6" aria-hidden />
        </Button>
        <SidebarContent onNavigate={() => setMenuOpen(false)} onHelp={openHelp} />
      </aside>

      {/* Mounted once: the conversation survives closing and reopening the panel. */}
      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
