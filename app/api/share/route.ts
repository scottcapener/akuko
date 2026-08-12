import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { shareChapter } from "@/lib/shared/share";

// Node runtime: the snapshot path sanitizes scene HTML (sanitize-html needs
// Node APIs).
export const runtime = "nodejs";

// Share a chapter with one or more people by email (SHARED_WITH_YOU.md §3.5).
// Snapshots the chapter on first share, then grants access. Runs under the
// caller's session — RLS guarantees they can only snapshot their own chapter
// and write grants on a snapshot they own.
//
// Stage 1: grants are created PENDING; the share email + recipient resolution
// land in Stage 2 (the Share-modal UI calls this route).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { chapterId?: unknown; emails?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const emails = Array.isArray(body.emails)
    ? body.emails.filter((e): e is string => typeof e === "string")
    : [];

  try {
    const result = await shareChapter(supabase, user.id, chapterId, emails);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to share chapter";
    // "Chapter not found" is the RLS/ownership failure surface.
    const status = message === "Chapter not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
