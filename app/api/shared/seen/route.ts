import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { markChapterSeen } from "@/lib/shared/unread";

export const runtime = "nodejs";

// Advance the caller's read cursor for one shared chapter (§6) — clears its
// unread state. The editor Comments tab calls this on open; the read view marks
// itself seen server-side while building the view (lib/shared/read.ts).
//
//   POST { sharedChapterId }  → { ok: true }

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sharedChapterId = typeof body.sharedChapterId === "string" ? body.sharedChapterId : "";
  if (!sharedChapterId) {
    return NextResponse.json({ error: "sharedChapterId is required." }, { status: 400 });
  }

  await markChapterSeen(supabase, user.id, sharedChapterId);
  return NextResponse.json({ ok: true });
}
