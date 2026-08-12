import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shareChapter } from "@/lib/shared/share";
import { getShareState } from "@/lib/shared/state";
import { sendShareEmail } from "@/lib/email/shareEmail";

// Node runtime: the snapshot path sanitizes scene HTML (sanitize-html needs
// Node APIs).
export const runtime = "nodejs";

// The author's sharing surface for one chapter (SHARED_WITH_YOU.md §3.5/§3.6).
// Every method runs under the caller's session — RLS guarantees they can only
// touch a snapshot they own.
//
//   GET    ?chapterId=…  → current share state (mini-menu + modal)
//   POST   { chapterId, emails }  → first share / add recipients
//   DELETE ?chapterId=…  → stop sharing entirely (delete the snapshot)

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const chapterId = new URL(request.url).searchParams.get("chapterId") ?? "";
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const state = await getShareState(supabase, chapterId);
  return NextResponse.json(state);
}

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

  let result;
  try {
    result = await shareChapter(supabase, user.id, chapterId, emails);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to share chapter";
    const status = message === "Chapter not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  // Redeem existing accounts immediately, then email the newly-added recipients.
  // Both are best-effort — the share itself is already committed.
  if (result.addedEmails.length) {
    const admin = createAdminClient();
    if (admin) {
      await admin
        .rpc("resolve_share_recipients", { target: result.sharedChapterId })
        .then(({ error }) => {
          if (error) console.error("[share] resolve_share_recipients:", error.message);
        });
    }
    await notifyNewRecipients(supabase, user.id, user.email ?? "", result.sharedChapterId, result.addedEmails);
  }

  const state = await getShareState(supabase, chapterId);
  return NextResponse.json({ ok: true, ...state });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const chapterId = new URL(request.url).searchParams.get("chapterId") ?? "";
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  // Delete the snapshot; ON DELETE CASCADE clears its scenes, grants, and reads.
  // RLS ("owner writes") confines this to a snapshot the caller owns.
  const { error } = await supabase.from("shared_chapters").delete().eq("chapter_id", chapterId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, chapterId, sharedChapterId: null, shared: false, recipients: [] });
}

/** Email each newly-added recipient the "shared a chapter with you" note. */
async function notifyNewRecipients(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  ownerId: string,
  authorEmail: string,
  sharedChapterId: string,
  emails: string[]
): Promise<void> {
  const [{ data: profile }, { data: snapshot }] = await Promise.all([
    supabase.from("profiles").select("display_name, pen_name").eq("id", ownerId).maybeSingle(),
    supabase
      .from("shared_chapters")
      .select("book_title, chapter_title")
      .eq("id", sharedChapterId)
      .maybeSingle(),
  ]);

  const authorName =
    (profile?.pen_name as string | null) || (profile?.display_name as string | null) || "A writer";

  await Promise.all(
    emails.map((to) =>
      sendShareEmail({
        to,
        authorName,
        authorEmail,
        bookTitle: (snapshot?.book_title as string) ?? "",
        chapterTitle: (snapshot?.chapter_title as string) ?? "",
        sharedChapterId,
      })
    )
  );
}
