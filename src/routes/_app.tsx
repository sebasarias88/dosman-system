import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import { AppBootSkeleton } from '@/components/ui/skeleton'
import { staffContextQuery } from '@/features/auth/auth-api'
import { BranchRealtime } from '@/features/sales/branch-realtime'

/** Everything under this layout requires an active staff session. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const staff = await context.queryClient.ensureQueryData(staffContextQuery)
    if (!staff) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { staff }
  },
  // While the session is checked on the first load: the shell's shape, not a blank page.
  pendingComponent: AppBootSkeleton,
  component: AppLayout,
})

function AppLayout() {
  return (
    <AppShell>
      <BranchRealtime />
      <Outlet />
    </AppShell>
  )
}
