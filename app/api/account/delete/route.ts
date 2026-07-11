import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Node runtime: uses the service role to sweep Storage and delete the user.
export const runtime = "nodejs";

/** Collect every stored object this user owns, keyed by bucket. Read before
 *  the user is deleted (deleting cascades the rows that record these paths).
 *  library-files has no user_id column, so its paths come via books→chapters;
 *  backups/exports carry user_id directly. */
async function collectStoragePaths(
  admin: SupabaseClient,
  userId: string
): Promise<Record<string, string[]>> {
  const { data: books } = await admin.from("books").select("id").eq("user_id", userId);
  const bookIds = (books ?? []).map((b) => b.id);

  let libraryPaths: string[] = [];
  if (bookIds.length) {
    const { data: chapters } = await admin.from("chapters").select("id").in("book_id", bookIds);
    const chapterIds = (chapters ?? []).map((c) => c.id);
    if (chapterIds.length) {
      const { data: items } = await admin
        .from("library_items")
        .select("storage_path")
        .in("chapter_id", chapterIds)
        .not("storage_path", "is", null);
      libraryPaths = (items ?? []).map((i) => i.storage_path as string);
    }
  }

  const [{ data: backups }, { data: exports }] = await Promise.all([
    admin.from("backups").select("storage_path").eq("user_id", userId),
    admin.from("exports").select("storage_path").eq("user_id", userId),
  ]);

  return {
    "library-files": libraryPaths,
    "book-backups": (backups ?? []).map((b) => b.storage_path as string),
    "book-exports": (exports ?? []).map((e) => e.storage_path as string),
  };
}

export async function POST() {
  // Get the current user from the session cookie
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Use service role key to delete the user (admin operation)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Sweep Storage before deleting the account. Deleting the user cascades the
  // DB rows but leaves their bucket objects orphaned, so remove them first.
  // Best-effort: a failed removal shouldn't block account deletion.
  try {
    const paths = await collectStoragePaths(adminClient, user.id);
    await Promise.all(
      Object.entries(paths).map(([bucket, keys]) =>
        keys.length ? adminClient.storage.from(bucket).remove(keys) : Promise.resolve()
      )
    );
  } catch {
    // Ignore — proceed to delete the account regardless.
  }

  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
