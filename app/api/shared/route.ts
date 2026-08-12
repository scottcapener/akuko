import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSharedFeed } from "@/lib/shared/feed";

export const runtime = "nodejs";

// GET /api/shared — the recipient's "Shared With You" feed (§3.2). Redeems any
// pending grants for this email first, so a chapter shared before their account
// resolves the moment they open /shared.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Safety-net redemption (idempotent; complements the login/signup hooks).
  try {
    await supabase.rpc("redeem_my_shares");
  } catch {
    // ignore — feed still renders whatever's already granted
  }

  const items = await getSharedFeed(supabase, user.id);
  return NextResponse.json({ items });
}
