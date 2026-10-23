import { redirect } from '@tanstack/react-router'
import { canUseModule, getModule, type ModuleKey } from '@/config/modules'
import { getActiveBranch } from './active-branch'
import type { StaffContext } from './auth-api'

/**
 * Route guard: sends the person to the home screen when their role (or the
 * active branch) can't use a module. This only hides screens; the real
 * protection is RLS in the database.
 */
export function requireModule(key: ModuleKey) {
  return ({ context }: { context: { staff: StaffContext } }) => {
    const { profile, branches } = context.staff
    if (!canUseModule(getModule(key), profile.role, getActiveBranch(branches))) {
      throw redirect({ to: '/' })
    }
  }
}
