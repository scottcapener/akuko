import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for the few server operations that must bypass RLS or
// reach the auth schema (see app/api/account/delete for the established
// pattern). Returns null when the key isn't configured so callers can degrade
// gracefully. NEVER import from a client component — the key must never reach
// the browser bundle.
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
