import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { snapshotChapter } from "@/lib/shared/snapshot";
import { getShareState } from "@/lib/shared/state";

export const runtime = "nodejs";

// "Update shared copy" (SHARED_WITH_YOU.md §3.6/§7): re-snapshot the live
// chapter in place. Recipients all see the new copy; existing grants are
// untouched. Owner-only (snapshotChapter writes under the caller's session).
//
// Stale-comment handling on re-share is Stage 4 — there are no comments yet.
//
//   POST { chapterId }
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { chapterId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  try {
    await snapshotChapter(supabase, chapterId, user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update shared copy";
    const status = message === "Chapter not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const state = await getShareState(supabase, chapterId);
  return NextResponse.json({ ok: true, ...state });
}
