/**
 * Hand-written types for the tables used by the app shell.
 * Once the Supabase project exists, `yarn db:types` generates the full
 * `database.ts` and these will be derived from it.
 */
export type AppRole = 'owner' | 'admin' | 'cashier' | 'waiter' | 'kitchen'

export interface Profile {
  id: string
  username: string
  full_name: string
  role: AppRole
  branch_id: string | null
  is_active: boolean
}

export interface Branch {
  id: string
  name: string
  is_main: boolean
  uses_waiters: boolean
  takes_delivery: boolean
  is_active: boolean
}

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  cashier: 'Caja',
  waiter: 'Mesero',
  kitchen: 'Preparación',
}
