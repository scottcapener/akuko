import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Edit or delete one comment (SHARED_WITH_YOU.md §3.4). RLS confines both to the
// comment's author — the owner can resolve (separate route) but never edit or
// delete someone else's words.
//
//   PATCH  { body }   — edit your own comment
//   DELETE            — delete your own comment

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { commentId } = await params;
  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment can’t be empty." }, { status: 400 });

  const { data, error } = await supabase
    .from("comments")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // RLS hid it (not the author) → no row updated.
  if (!data) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  return NextResponse.json({ ok: true, id: commentId, body: text });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { commentId } = await params;
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: commentId });
}
