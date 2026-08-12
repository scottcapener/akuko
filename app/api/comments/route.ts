import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getComments, createComment } from "@/lib/shared/comments";

export const runtime = "nodejs";

// Comments on a shared chapter (SHARED_WITH_YOU.md §3.4). Runs under the
// caller's session — RLS gates read/write to chapters they can access.
//
//   GET  ?sharedChapterId=…  → { ownerId, comments }
//   POST { sharedChapterId, sharedSceneId, body, quoteText, quoteStart, quoteEnd }

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sharedChapterId = new URL(request.url).searchParams.get("sharedChapterId") ?? "";
  if (!sharedChapterId) {
    return NextResponse.json({ error: "sharedChapterId is required." }, { status: 400 });
  }

  const result = await getComments(supabase, sharedChapterId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}

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
  const sharedSceneId = typeof body.sharedSceneId === "string" ? body.sharedSceneId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!sharedChapterId || !sharedSceneId) {
    return NextResponse.json({ error: "sharedChapterId and sharedSceneId are required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Comment can’t be empty." }, { status: 400 });
  }

  try {
    const comment = await createComment(supabase, user.id, {
      sharedChapterId,
      sharedSceneId,
      body: text,
      quoteText: typeof body.quoteText === "string" ? body.quoteText : "",
      quoteStart: Number.isFinite(body.quoteStart) ? Number(body.quoteStart) : 0,
      quoteEnd: Number.isFinite(body.quoteEnd) ? Number(body.quoteEnd) : 0,
    });
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    // An RLS failure (no access) surfaces as an insert error.
    const message = err instanceof Error ? err.message : "Failed to add comment";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
