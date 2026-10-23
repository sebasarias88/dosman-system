import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { modulesFor } from '@/config/modules'
import { useStaff } from '@/features/auth/use-staff'

export const Route = createFileRoute('/_app/')({
  component: HomeScreen,
})

const todayFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Bogota',
})

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('es-CO', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'America/Bogota',
    }).format(new Date()),
  )
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function HomeScreen() {
  const { profile, activeBranch } = useStaff()
  const shortcuts = modulesFor(profile.role, activeBranch).filter((m) => m.key !== 'dashboard')
  const firstName = profile.full_name.split(' ')[0]

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <header>
        <p className="text-sm text-fg-subtle first-letter:uppercase">{todayFormatter.format(new Date())}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        {activeBranch && <p className="mt-1 text-fg-muted">{activeBranch.name}</p>}
      </header>

      <section aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map(({ key, path, label, description, icon: Icon }) => (
          <Link
            key={key}
            to={path}
            className="group flex min-h-28 gap-4 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between font-medium">
                {label}
                <ArrowUpRight
                  className="size-4 text-fg-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
              <span className="mt-1 block text-sm text-fg-muted">{description}</span>
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}
