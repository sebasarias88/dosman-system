import { queryOptions } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { AppRole } from '@/types/app'

export { ROLE_LABELS } from '@/types/app'

export interface StaffMember {
  id: string
  username: string
  full_name: string
  role: AppRole
  branch_id: string | null
  is_active: boolean
  created_at: string
}

export const ROLE_HELP: Record<AppRole, string> = {
  owner: 'Ve y controla todo, incluidos empleados y ajustes.',
  admin: 'Todo lo del negocio en todas las sedes, menos empleados y ajustes.',
  cashier: 'Cobra, abre y cierra caja, inventario y compras de su sede.',
  waiter: 'Toma pedidos en las mesas. Nunca maneja dinero.',
  kitchen: 'Ve la pantalla de preparación de su sede.',
}

/** Roles that work in one branch only. */
export const BRANCH_ROLES: AppRole[] = ['cashier', 'waiter', 'kitchen']

export const staffQuery = queryOptions({
  queryKey: ['staff'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, role, branch_id, is_active, created_at')
      .order('is_active', { ascending: false })
      .order('full_name')
    if (error) throw error
    return data as StaffMember[]
  },
})

export interface NewStaffInput {
  username: string
  full_name: string
  role: AppRole
  branch_id: string | null
  pin: string
}

export async function createStaff(input: NewStaffInput): Promise<{ id: string }> {
  return apiJson('/api/staff', { method: 'POST', body: input })
}

export interface StaffUpdate {
  id: string
  full_name?: string
  role?: AppRole
  branch_id?: string | null
  is_active?: boolean
  pin?: string
}

export async function updateStaff({ id, ...changes }: StaffUpdate): Promise<StaffMember> {
  return apiJson(`/api/staff/${id}`, { method: 'PATCH', body: changes })
}

/** Same rule as the server: 6 digits and not 000000, 123456, 654321… */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'El PIN debe tener exactamente 6 números'
  if (/^(\d)\1{5}$/.test(pin)) return 'No uses el mismo número repetido'
  const digits = [...pin].map(Number)
  const steps = digits.slice(1).map((d, i) => d - (digits[i] ?? 0))
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'No uses números seguidos (123456)'
  return null
}

/** "María López" -> "maria.lopez" */
export function suggestUsername(fullName: string): string {
  const parts = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  return parts.slice(0, 2).join('.').slice(0, 30)
}
