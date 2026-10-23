import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Branch, Profile } from '@/types/app'

/**
 * Staff sign in with a username and a 6-digit PIN. Supabase Auth needs an
 * email, so each username maps to an internal address that never receives mail.
 */
const STAFF_EMAIL_DOMAIN = 'dosman.internal'

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/
export const PIN_LENGTH = 6

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${STAFF_EMAIL_DOMAIN}`
}

export async function signIn(username: string, pin: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password: pin,
  })
  if (error) {
    // Same message for wrong user or wrong PIN, so nobody can guess usernames.
    throw new Error('Usuario o PIN incorrectos')
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export interface StaffContext {
  profile: Profile
  branches: Branch[]
}

/** Loads the signed-in staff member and the branches they can work in. */
async function fetchStaffContext(): Promise<StaffContext | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name, role, branch_id, is_active')
    .eq('id', userId)
    .maybeSingle<Profile>()
  if (profileError) throw profileError
  if (!profile || !profile.is_active) return null

  const { data: branches, error: branchesError } = await supabase
    .from('branches')
    .select('id, name, is_main, uses_waiters, takes_delivery, is_active')
    .eq('is_active', true)
    .order('is_main', { ascending: false })
    .returns<Branch[]>()
  if (branchesError) throw branchesError

  const allowed = profile.branch_id ? branches.filter((b) => b.id === profile.branch_id) : branches
  return { profile, branches: allowed }
}

export const staffContextQuery = queryOptions({
  queryKey: ['staff-context'],
  queryFn: fetchStaffContext,
  staleTime: 5 * 60_000,
})
