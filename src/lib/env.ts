function requireEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = import.meta.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    // Fail loudly in development instead of showing a blank screen.
    throw new Error(`Falta ${name}. Copia .env.example a .env.local y completa los datos de Supabase.`)
  }
  return value
}

export const env = {
  VITE_SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
}
