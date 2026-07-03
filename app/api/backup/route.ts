import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateBackup } from "@/lib/backup/generate";

// Node runtime: generation reads Storage blobs and zips them with fflate.
export const runtime = "nodejs";

/**
 * Manual backup. Runs as the signed-in user (RLS-scoped), targeting the
 * book id in the request body, or the user's active (most-recently-opened)
 * book when none is given.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let bookId: string | undefined;
  try {
    const body = await request.json();
    bookId = body?.bookId;
  } catch {
    // no body — fall back to active book
  }

  if (!bookId) {
    const { data: books } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", user.id)
      .order("last_opened_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1);
    bookId = books?.[0]?.id;
  }

  if (!bookId) {
    return NextResponse.json({ error: "No book to back up" }, { status: 400 });
  }

  try {
    const result = await generateBackup(supabase, user.id, bookId, "manual");
    return NextResponse.json({ ok: true, backup: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
