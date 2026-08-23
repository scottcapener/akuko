import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user unread state across every shared chapter the caller can access
// (SHARED_WITH_YOU.md §6). One table — shared_chapter_reads — drives it, exactly
// as §2 describes: no read row = an unread shared chapter; a comment created
// after your last_seen_at = an unread comment. Unread-comment state matters for
// everyone with access (owner and recipients), because the conversation is
// shared. Runs under the caller's session; RLS scopes shared_chapters/comments
// to what they may see, so we never widen access here.

export interface ChapterUnread {
  /** Live chapter id — null if the live chapter was deleted (snapshot outlives it). */
  chapterId: string | null;
  sharedChapterId: string;
  /** Comments by other people since your last visit (drives the tab count). */
  unreadComments: number;
  /** Every comment on the chapter, mine included (drives the dim total badge). */
  totalComments: number;
  /** Whether this chapter needs your attention at all (drives dots + the total). */
  unread: boolean;
}

export interface UnreadState {
  /** Chapters needing attention — the account-menu "Shared" count. */
  total: number;
  chapters: ChapterUnread[];
}

export async function getUnreadState(
  supabase: SupabaseClient,
  userId: string
): Promise<UnreadState> {
  // Accessible, still-shared snapshots (RLS → owned + accepted-recipient).
  const { data: chapters } = await supabase
    .from("shared_chapters")
    .select("id, chapter_id, owner_id")
    .is("unshared_at", null);
  const rows = chapters ?? [];
  if (!rows.length) return { total: 0, chapters: [] };

  const ids = rows.map((c) => c.id);

  // My read cursors (own-row RLS).
  const { data: reads } = await supabase
    .from("shared_chapter_reads")
    .select("shared_chapter_id, last_seen_at")
    .eq("user_id", userId)
    .in("shared_chapter_id", ids);
  const seenAt = new Map<string, number>(
    (reads ?? []).map((r) => [r.shared_chapter_id as string, new Date(r.last_seen_at as string).getTime()])
  );

  // Every comment on my accessible chapters. RLS already confines this to
  // chapters I can access; the .in() keeps it to the live set. We tally two
  // things: the total (all authors, drives the dim badge) and the unread count
  // (others only, postdating my cursor — my own are never unread to me).
  const { data: comments } = await supabase
    .from("comments")
    .select("shared_chapter_id, author_id, created_at")
    .in("shared_chapter_id", ids);

  const newCommentCounts = new Map<string, number>();
  const totalCommentCounts = new Map<string, number>();
  for (const c of comments ?? []) {
    const key = c.shared_chapter_id as string;
    totalCommentCounts.set(key, (totalCommentCounts.get(key) ?? 0) + 1);
    if (c.author_id === userId) continue;
    const seen = seenAt.get(key);
    // Unread when there's no cursor yet, or the comment postdates it.
    if (seen == null || new Date(c.created_at as string).getTime() > seen) {
      newCommentCounts.set(key, (newCommentCounts.get(key) ?? 0) + 1);
    }
  }

  const out: ChapterUnread[] = rows.map((c) => {
    const isOwner = c.owner_id === userId;
    const neverOpened = !seenAt.has(c.id);
    const unreadComments = newCommentCounts.get(c.id) ?? 0;
    // A recipient's never-opened share is unread on its own (someone shared a
    // chapter with you); an owner's own snapshot is not. New comments make
    // either surface unread.
    const unread = unreadComments > 0 || (!isOwner && neverOpened);
    return {
      chapterId: (c.chapter_id as string | null) ?? null,
      sharedChapterId: c.id as string,
      unreadComments,
      totalComments: totalCommentCounts.get(c.id) ?? 0,
      unread,
    };
  });

  return { total: out.filter((c) => c.unread).length, chapters: out };
}

/** Mark a shared chapter seen for the caller — clears its unread state. Called
 *  when the read view or the editor Comments tab opens. Best-effort; own-row RLS
 *  confines the write to the caller's cursor. */
export async function markChapterSeen(
  supabase: SupabaseClient,
  userId: string,
  sharedChapterId: string
): Promise<void> {
  await supabase.from("shared_chapter_reads").upsert(
    { shared_chapter_id: sharedChapterId, user_id: userId, last_seen_at: new Date().toISOString() },
    { onConflict: "shared_chapter_id,user_id" }
  );
}
