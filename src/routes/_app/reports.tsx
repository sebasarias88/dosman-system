import { createFileRoute } from '@tanstack/react-router'
import { ModulePlaceholder } from '@/components/layout/module-placeholder'
import { requireModule } from '@/features/auth/require-module'

export const Route = createFileRoute('/_app/reports')({
  beforeLoad: requireModule('reports'),
  component: () => <ModulePlaceholder moduleKey="reports" />,
})
