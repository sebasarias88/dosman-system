import { createFileRoute } from '@tanstack/react-router'
import { ModulePlaceholder } from '@/components/layout/module-placeholder'
import { requireModule } from '@/features/auth/require-module'

export const Route = createFileRoute('/_app/storage')({
  beforeLoad: requireModule('storage'),
  component: () => <ModulePlaceholder moduleKey="storage" />,
})
