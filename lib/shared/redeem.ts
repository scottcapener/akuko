"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

// Redeem the current user's pending shares by email match (SHARED_WITH_YOU.md
// §4). Idempotent and best-effort — call it right after signup/login. The
// heavy lifting is the redeem_my_shares() SECURITY DEFINER function (013).
export async function redeemShares(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.rpc("redeem_my_shares");
  } catch {
    // Never block an auth flow on redemption; the /shared surfaces retry it.
  }
}
