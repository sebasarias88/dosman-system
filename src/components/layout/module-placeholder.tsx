import { Construction } from 'lucide-react'
import { getModule, type ModuleKey } from '@/config/modules'

/** Temporary screen for modules that are built in later feature branches. */
export function ModulePlaceholder({ moduleKey }: { moduleKey: ModuleKey }) {
  const { label, description, icon: Icon } = getModule(moduleKey)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-fg">
          <Icon className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="text-fg-muted">{description}</p>
        </div>
      </header>
      <div className="flex items-center gap-3 rounded-card border border-dashed border-line-strong p-6 text-fg-muted">
        <Construction className="size-5 shrink-0" aria-hidden />
        Este módulo se construye en las próximas etapas.
      </div>
    </div>
  )
}
