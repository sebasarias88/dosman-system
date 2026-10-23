import { useSuspenseQuery } from '@tanstack/react-query'
import { staffContextQuery, type StaffContext } from './auth-api'
import { useActiveBranch } from './active-branch'
import type { Branch } from '@/types/app'

export interface Staff extends StaffContext {
  activeBranch: Branch | undefined
}

/** Signed-in staff member. Only used under the protected `_app` layout. */
export function useStaff(): Staff {
  const { data } = useSuspenseQuery(staffContextQuery)
  if (!data) throw new Error('useStaff used outside an authenticated route')
  const activeBranch = useActiveBranch(data.branches)
  return { ...data, activeBranch }
}
