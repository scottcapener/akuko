"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In development, auto sign-in via server-side credentials if no session exists.
 * Credentials stay in server-side env vars (no NEXT_PUBLIC_) and never reach the
 * client bundle. No-op in production. Call before getUser() on any page that
 * reads user-scoped data outside the Write page's hook.
 */
export async function ensureDevSession(supabase: SupabaseClient) {
  if (process.env.NODE_ENV !== "development" || !process.env.NEXT_PUBLIC_DEV_USER_ID) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;
  const res = await fetch("/api/dev/session", { method: "POST" });
  if (res.ok) {
    const tokens = await res.json();
    await supabase.auth.setSession(tokens);
  }
}
