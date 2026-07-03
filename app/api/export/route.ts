import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateExport } from "@/lib/export/generate";

// Node runtime: generation builds a .docx with the `docx` library.
export const runtime = "nodejs";

/**
 * Manuscript export. Runs as the signed-in user (RLS-scoped), targeting the
 * book id in the request body, or the user's active (most-recently-opened)
 * book when none is given. An optional `chapterIds` array exports only those
 * chapters (a partial / sample-chapters export).
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let bookId: string | undefined;
  let chapterIds: string[] | undefined;
  try {
    const body = await request.json();
    bookId = body?.bookId;
    if (Array.isArray(body?.chapterIds)) {
      chapterIds = body.chapterIds.filter((id: unknown): id is string => typeof id === "string");
    }
  } catch {
    // no body — fall back to active book, full export
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
    return NextResponse.json({ error: "No book to export" }, { status: 400 });
  }

  try {
    const result = await generateExport(supabase, user.id, bookId, chapterIds);
    return NextResponse.json({ ok: true, export: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
