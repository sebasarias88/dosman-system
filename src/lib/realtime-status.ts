/*
 * Whether the live updates (Supabase Realtime) are connected right now.
 *
 * Why it matters: every refetch is data leaving Supabase (egress, 5 GB/month
 * on the free plan). While Realtime is connected the screens refresh only
 * when something actually changes; polling is just a safety net for when
 * the connection drops.
 */
let connected = false

export function setRealtimeConnected(value: boolean): void {
  connected = value
}

/** refetchInterval for live screens: no polling while Realtime works, every minute if it doesn't. */
export function pollWhenOffline(): number | false {
  return connected ? false : 60_000
}
