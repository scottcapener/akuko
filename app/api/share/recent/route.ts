import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getRecentPartners } from "@/lib/shared/recent";

export const runtime = "nodejs";

// Recent share partners for the Share modal's quick-list (SHARED_WITH_YOU.md
// §3.5). Runs under the author's session; RLS + the owner_id filter keep it to
// people they've shared with.
//
//   GET  → { partners }
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const partners = await getRecentPartners(supabase, user.id);
  return NextResponse.json({ partners });
}
