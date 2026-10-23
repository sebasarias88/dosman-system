export interface Env {
  /** R2 bucket with product photos (public read) and expense receipts (staff only). */
  MEDIA: R2Bucket
  /** Static assets of the React app (bound automatically by Wrangler). */
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}
