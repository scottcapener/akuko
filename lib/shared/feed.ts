import type { SupabaseClient } from "@supabase/supabase-js";
import { signSharedPaths } from "./covers";

// The "Shared With You" feed (SHARED_WITH_YOU.md §3.2): a flat, chronological
// list of chapters shared WITH the current user, newest first. Runs under the
// recipient's session; RLS confines every read to snapshots they can access.

export interface FeedItem {
  sharedChapterId: string;
  chapterTitle: string;
  bookTitle: string;
  coverUrl: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  sharedAt: string; // ISO — when it was shared with me (grant created_at)
  unread: boolean; // never opened (no shared_chapter_reads row)
}

export async function getSharedFeed(
  supabase: SupabaseClient,
  userId: string
): Promise<FeedItem[]> {
  // My active grants, newest first (share order).
  const { data: grants } = await supabase
    .from("chapter_shares")
    .select("shared_chapter_id, created_at")
    .eq("recipient_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const rows = grants ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.shared_chapter_id);
  const sharedAtById = new Map<string, string>();
  rows.forEach((r) => sharedAtById.set(r.shared_chapter_id, r.created_at));

  const [{ data: chapters }, { data: reads }] = await Promise.all([
    supabase
      .from("shared_chapters")
      .select("id, owner_id, book_title, cover_path, chapter_title")
      .in("id", ids),
    supabase
      .from("shared_chapter_reads")
      .select("shared_chapter_id")
      .eq("user_id", userId)
      .in("shared_chapter_id", ids),
  ]);

  const chapterRows = chapters ?? [];
  const readSet = new Set((reads ?? []).map((r) => r.shared_chapter_id));

  // Owner profiles for the book credit (pen_name || display_name) + avatar.
  const ownerIds = [...new Set(chapterRows.map((c) => c.owner_id))];
  const profileById = new Map<
    string,
    { display_name: string | null; pen_name: string | null; avatar_path: string | null }
  >();
  if (ownerIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, pen_name, avatar_path")
      .in("id", ownerIds);
    (profiles ?? []).forEach((p) =>
      profileById.set(p.id, {
        display_name: p.display_name,
        pen_name: p.pen_name,
        avatar_path: p.avatar_path,
      })
    );
  }

  // Sign covers + avatars together (one admin client).
  const coverUrls = await signSharedPaths(chapterRows.map((c) => c.cover_path));
  const avatarUrls = await signSharedPaths(
    chapterRows.map((c) => profileById.get(c.owner_id)?.avatar_path ?? null)
  );

  const byId = new Map<string, FeedItem>();
  chapterRows.forEach((c, i) => {
    const profile = profileById.get(c.owner_id);
    byId.set(c.id, {
      sharedChapterId: c.id,
      chapterTitle: c.chapter_title || "Untitled chapter",
      bookTitle: c.book_title || "",
      coverUrl: coverUrls[i],
      authorName: profile?.pen_name || profile?.display_name || "A writer",
      authorAvatarUrl: avatarUrls[i],
      sharedAt: sharedAtById.get(c.id) ?? "",
      unread: !readSet.has(c.id),
    });
  });

  // Preserve grant order (newest first); drop any grant whose snapshot RLS
  // hid (shouldn't happen, but keeps the list consistent).
  return ids.map((id) => byId.get(id)).filter((x): x is FeedItem => !!x);
}
