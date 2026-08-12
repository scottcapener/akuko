import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Resolve / unresolve one comment (SHARED_WITH_YOU.md §3.4). Goes through the
// set_comment_resolved SECURITY DEFINER function, which enforces that only the
// CHAPTER OWNER may resolve and limits the write to resolved_at/resolved_by —
// so the owner can mark done without editing others' words.
//
//   POST { resolved: boolean }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { commentId } = await params;
  let payload: { resolved?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const resolved = payload.resolved !== false; // default to resolving

  const { error } = await supabase.rpc("set_comment_resolved", {
    target: commentId,
    resolved,
  });
  if (error) {
    // The function raises when the caller isn't the chapter owner.
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, id: commentId, resolved });
}
