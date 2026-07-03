import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateBackup } from "@/lib/backup/generate";

// Node runtime: generation reads Storage blobs and zips them with fflate.
export const runtime = "nodejs";

const CADENCE_INTERVAL_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Automatic-backup cadence sweep. Meant to be hit at least hourly by a
 * scheduler (Supabase Cron → this route). Guarded by CRON_SECRET.
 *
 * Selects books with a cadence set whose last_auto_backup_at is older
 * than the cadence interval (or never run), backs each up with
 * trigger:auto using the service role, then stamps last_auto_backup_at.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: books, error } = await admin
    .from("books")
    .select("id, user_id, auto_backup_cadence, last_auto_backup_at")
    .neq("auto_backup_cadence", "off");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const due = (books ?? []).filter((b) => {
    const interval = CADENCE_INTERVAL_MS[b.auto_backup_cadence];
    if (!interval) return false;
    if (!b.last_auto_backup_at) return true;
    return now - new Date(b.last_auto_backup_at).getTime() >= interval;
  });

  let created = 0;
  const failures: { bookId: string; error: string }[] = [];

  for (const book of due) {
    try {
      await generateBackup(admin, book.user_id, book.id, "auto");
      await admin
        .from("books")
        .update({ last_auto_backup_at: new Date().toISOString() })
        .eq("id", book.id);
      created++;
    } catch (err) {
      failures.push({
        bookId: book.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({ ok: true, considered: due.length, created, failures });
}

export async function POST(request: Request) {
  return handle(request);
}

// Allow GET too, so simple cron pingers (Vercel Cron, curl) work.
export async function GET(request: Request) {
  return handle(request);
}
