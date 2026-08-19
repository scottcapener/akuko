import { createAdminClient } from "@/lib/supabase/admin";
import { sendCommentEmail } from "@/lib/email/commentEmail";

// Notify a chapter's author that a reader commented (SHARED_WITH_YOU.md §5).
// "Leading-edge" debounce: the email fires on the FIRST comment of a commenter's
// session and links to the chapter; comments within COOLDOWN_MS stay silent (the
// link already shows them). One email per (chapter, commenter) session, keeping
// the fan-out matched to how writing-group members actually comment — async, on
// their own schedules — rather than blasting one per comment.
//
// Runs entirely through the service-role client: the commenter's session can't
// (and mustn't) read the author's email or notify preference under RLS, and the
// cooldown ledger is service-role-only (migration 017). Best-effort — every exit
// is a silent return so a notification hiccup never affects the committed comment.

// One commenter's "session" on a chapter. Long enough to cover a single sitting
// of reading-and-commenting; a return visit later is a fresh notification.
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface NotifyCommentInput {
  sharedChapterId: string;
  /** The comment's author (profiles.id / auth uid). */
  commenterId: string;
}

export async function notifyCommentActivity({
  sharedChapterId,
  commenterId,
}: NotifyCommentInput): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    console.info("[commentNotify] SUPABASE_SERVICE_ROLE_KEY unset — skipping notification");
    return;
  }

  try {
    // Chapter → author + snapshot titles for the email.
    const { data: chapter } = await admin
      .from("shared_chapters")
      .select("owner_id, book_title, chapter_title")
      .eq("id", sharedChapterId)
      .maybeSingle();
    if (!chapter) return;

    const ownerId = chapter.owner_id as string;
    // The author commenting on their own chapter has no one to notify.
    if (ownerId === commenterId) return;

    // Author's preference — default opted-in when the column/row is missing.
    const { data: pref } = await admin
      .from("profiles")
      .select("notify_on_comment")
      .eq("id", ownerId)
      .maybeSingle();
    if (pref?.notify_on_comment === false) return;

    // Cooldown: skip if this commenter already triggered an email on this chapter
    // within the window.
    const { data: last } = await admin
      .from("comment_notifications")
      .select("last_notified_at")
      .eq("shared_chapter_id", sharedChapterId)
      .eq("commenter_id", commenterId)
      .maybeSingle();
    if (last?.last_notified_at) {
      const age = Date.now() - new Date(last.last_notified_at as string).getTime();
      if (age < COOLDOWN_MS) return;
    }

    // Author's email (auth schema) + the commenter's display name.
    const [{ data: authUser }, { data: commenter }] = await Promise.all([
      admin.auth.admin.getUserById(ownerId),
      admin.from("profiles").select("display_name, pen_name").eq("id", commenterId).maybeSingle(),
    ]);
    const to = authUser?.user?.email;
    if (!to) return;

    const commenterName =
      (commenter?.display_name as string | null) ||
      (commenter?.pen_name as string | null) ||
      "Someone";

    const { sent } = await sendCommentEmail({
      to,
      commenterName,
      bookTitle: (chapter.book_title as string) ?? "",
      chapterTitle: (chapter.chapter_title as string) ?? "",
      sharedChapterId,
    });

    // Only start the cooldown once an email actually went out, so a skipped send
    // (no Resend key) or a failure doesn't suppress the next attempt.
    if (sent) {
      await admin
        .from("comment_notifications")
        .upsert(
          { shared_chapter_id: sharedChapterId, commenter_id: commenterId, last_notified_at: new Date().toISOString() },
          { onConflict: "shared_chapter_id,commenter_id" }
        );
    }
  } catch (err) {
    console.error("[commentNotify] failed:", err);
  }
}
