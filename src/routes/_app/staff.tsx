import { createFileRoute } from '@tanstack/react-router'
import { ModulePlaceholder } from '@/components/layout/module-placeholder'
import { requireModule } from '@/features/auth/require-module'

export const Route = createFileRoute('/_app/staff')({
  beforeLoad: requireModule('staff'),
  component: () => <ModulePlaceholder moduleKey="staff" />,
})
