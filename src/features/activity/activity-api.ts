import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { addDays } from '@/features/reports/periods'
import { supabase } from '@/lib/supabase'
import { ACTIVITY_GROUPS, type ActivityGroup } from './describe'

export type Severity = 'info' | 'warning' | 'critical'
export type SeverityFilter = 'all' | 'alerts' | 'critical'

export interface ActivityEntry {
  id: number
  action: string
  entity_type: string
  entity_id: string | null
  severity: Severity
  details: Record<string, unknown>
  created_at: string
  branch_id: string | null
  branches: { name: string } | null
  actor: { full_name: string } | null
}

export interface ActivityFilters {
  from: string
  to: string
  branchId: string | null
  severity: SeverityFilter
  group: ActivityGroup
}

const PAGE = 50

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

/** Calendar days in Colombia (UTC-5 all year) as timestamps. */
function bounds(from: string, to: string) {
  return { gte: `${from}T00:00:00-05:00`, lt: `${addDays(to, 1)}T00:00:00-05:00` }
}

function groupFilter(group: ActivityGroup): string | null {
  const prefixes = ACTIVITY_GROUPS.find((g) => g.id === group)?.prefixes ?? []
  // PostgREST "like" uses * as the wildcard.
  return prefixes.length ? prefixes.map((p) => `action.like.${p}*`).join(',') : null
}

export const activityQuery = (f: ActivityFilters) =>
  infiniteQueryOptions({
    queryKey: ['activity', 'list', f],
    initialPageParam: 0,
    getNextPageParam: (last: ActivityEntry[], pages) =>
      last.length === PAGE ? pages.length * PAGE : undefined,
    queryFn: async ({ pageParam }) => {
      const { gte, lt } = bounds(f.from, f.to)
      let query = supabase
        .from('audit_log')
        .select(
          `id, action, entity_type, entity_id, severity, details, created_at, branch_id,
           branches(name), actor:profiles!audit_log_actor_id_fkey(full_name)`,
        )
        .gte('created_at', gte)
        .lt('created_at', lt)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1)
      if (f.branchId) query = query.eq('branch_id', f.branchId)
      if (f.severity === 'alerts') query = query.in('severity', ['warning', 'critical'])
      if (f.severity === 'critical') query = query.eq('severity', 'critical')
      const groups = groupFilter(f.group)
      if (groups) query = query.or(groups)
      return unwrap<ActivityEntry[]>(await query)
    },
  })

/** How many warnings and critical events there are with the current period and branch. */
export const alertCountsQuery = (f: Pick<ActivityFilters, 'from' | 'to' | 'branchId'>) =>
  queryOptions({
    queryKey: ['activity', 'counts', f],
    queryFn: async () => {
      const { gte, lt } = bounds(f.from, f.to)
      const count = async (severity: Severity) => {
        let query = supabase
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .eq('severity', severity)
          .gte('created_at', gte)
          .lt('created_at', lt)
        if (f.branchId) query = query.eq('branch_id', f.branchId)
        const { count: total, error } = await query
        if (error) throw error
        return total ?? 0
      }
      const [warning, critical] = await Promise.all([count('warning'), count('critical')])
      return { warning, critical }
    },
  })
