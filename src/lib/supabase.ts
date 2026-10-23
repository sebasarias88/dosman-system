import { createClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Browser client. The publishable key is public by design: what protects the
 * data is Row Level Security in the database, not hiding this key.
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
