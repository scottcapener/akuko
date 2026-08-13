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
    await notifyNewRecipients(supabase, admin, user.id, user.email ?? "", result.sharedChapterId, result.addedEmails);
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

/** Email each newly-added recipient the "shared a chapter with you" note,
 *  skipping accounts that opted out (§6). */
async function notifyNewRecipients(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  admin: ReturnType<typeof createAdminClient>,
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

  // Recipients who have an account and turned off share emails. Read through the
  // service-role client so a recipient's preference never reaches the author's
  // session; pending recipients (no account, no preference) always get the email
  // — it's how they discover the share.
  const optedOut = new Set<string>();
  if (admin) {
    const { data: grants } = await admin
      .from("chapter_shares")
      .select("recipient_email, recipient_id")
      .eq("shared_chapter_id", sharedChapterId)
      .in("recipient_email", emails);
    const accountIds = (grants ?? [])
      .map((g) => g.recipient_id as string | null)
      .filter((id): id is string => !!id);
    if (accountIds.length) {
      const { data: prefs } = await admin
        .from("profiles")
        .select("id, notify_on_share")
        .in("id", accountIds);
      const muted = new Set(
        (prefs ?? []).filter((p) => p.notify_on_share === false).map((p) => p.id as string)
      );
      for (const g of grants ?? []) {
        if (g.recipient_id && muted.has(g.recipient_id as string)) {
          optedOut.add((g.recipient_email as string).toLowerCase());
        }
      }
    }
  }

  await Promise.all(
    emails
      .filter((to) => !optedOut.has(to.toLowerCase()))
      .map((to) =>
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
