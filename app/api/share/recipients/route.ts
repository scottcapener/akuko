import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getShareState } from "@/lib/shared/state";

export const runtime = "nodejs";

// Revoke one recipient's access (SHARED_WITH_YOU.md §7). Sets revoked_at rather
// than deleting the grant, so their existing comments stay attributed and
// visible to everyone else. Owner-only, via the "owner manages" RLS policy.
//
//   DELETE ?chapterId=…&email=…
export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const chapterId = params.get("chapterId") ?? "";
  const email = (params.get("email") ?? "").trim().toLowerCase();
  if (!chapterId || !email) {
    return NextResponse.json({ error: "chapterId and email are required." }, { status: 400 });
  }

  const { data: snapshot } = await supabase
    .from("shared_chapters")
    .select("id")
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (!snapshot) {
    return NextResponse.json({ error: "Chapter is not shared." }, { status: 404 });
  }

  const { error } = await supabase
    .from("chapter_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("shared_chapter_id", snapshot.id)
    .eq("recipient_email", email);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const state = await getShareState(supabase, chapterId);
  return NextResponse.json({ ok: true, ...state });
}
