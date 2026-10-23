import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
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
