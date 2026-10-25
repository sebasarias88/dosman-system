export interface Env {
  /** R2 bucket with product photos (public read) and expense receipts (staff only). */
  MEDIA: R2Bucket
  /** Static assets of the React app (bound automatically by Wrangler). */
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  /**
   * Secret (wrangler secret put). Bypasses the database rules, so it is used
   * only for: creating / editing staff accounts and delivering notifications.
   * It never reaches the browser.
   */
  SUPABASE_SECRET_KEY?: string
  /** Secret (wrangler secret put). Token of the Telegram bot from @BotFather. */
  TELEGRAM_BOT_TOKEN?: string
  /** Workers AI (help assistant). Free allowance: 10,000 neurons per day. */
  AI?: Ai
  /** Optional: another Workers AI model id for the assistant. */
  ASSISTANT_MODEL?: string
  /** Local tests only: "on" answers with a canned reply instead of calling the AI. */
  ASSISTANT_FAKE?: string
  /** Local tests only: points to a fake Telegram server. */
  TELEGRAM_API_URL?: string
}
