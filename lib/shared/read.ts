import type { SupabaseClient } from "@supabase/supabase-js";
import { signSharedPath } from "./covers";
import { markChapterSeen } from "./unread";

// One shared chapter, with book context, for the read view (SHARED_WITH_YOU.md
// §3.3). Runs under the recipient's session; RLS returns the snapshot only if
// they own it or are an accepted recipient — so a null result means "no access"
// (→ 404). Opening the view also marks the chapter read.

export interface ReadScene {
  id: string;
  bodyHtml: string; // sanitized at snapshot time (safe to render)
}

export interface BookPanelChapter {
  sharedChapterId: string;
  title: string;
  current: boolean;
}

export interface ReadView {
  sharedChapterId: string;
  bookTitle: string;
  chapterTitle: string;
  coverUrl: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  scenes: ReadScene[];
  /** The book's chapters this reader can access, in book order (Book Panel). */
  chapters: BookPanelChapter[];
  /** The viewer owns this book — they reached Read via "View as reader", not a
   *  share. Changes the exit target (back to Write, not the /shared feed). */
  isOwner: boolean;
}

export async function getSharedChapterView(
  supabase: SupabaseClient,
  userId: string,
  sharedChapterId: string
): Promise<ReadView | null> {
  const { data: snapshot } = await supabase
    .from("shared_chapters")
    .select("id, owner_id, book_id, book_title, cover_path, chapter_title")
    .eq("id", sharedChapterId)
    .maybeSingle();

  if (!snapshot) return null; // RLS hid it → no access

  const [{ data: profile }, { data: scenes }, { data: siblings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, pen_name, avatar_path")
      .eq("id", snapshot.owner_id)
      .maybeSingle(),
    supabase
      .from("shared_scenes")
      .select("id, body_html, position")
      .eq("shared_chapter_id", sharedChapterId)
      .order("position", { ascending: true }),
    // Every chapter of this book the reader can access (RLS filters), in book
    // order — the Book Panel + arrow navigation source.
    snapshot.book_id
      ? supabase
          .from("shared_chapters")
          .select("id, chapter_title, book_position")
          .eq("book_id", snapshot.book_id)
          .order("book_position", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);

  const coverUrl = await signSharedPath(snapshot.cover_path);
  const authorAvatarUrl = await signSharedPath(profile?.avatar_path ?? null);

  const chapters: BookPanelChapter[] = (siblings ?? [{ id: snapshot.id, chapter_title: snapshot.chapter_title }]).map(
    (c: { id: string; chapter_title: string | null }) => ({
      sharedChapterId: c.id,
      title: c.chapter_title || "Untitled chapter",
      current: c.id === sharedChapterId,
    })
  );

  // Mark read (clears the feed's unread dot + comment badges). Best-effort.
  await markChapterSeen(supabase, userId, sharedChapterId);

  return {
    sharedChapterId,
    bookTitle: snapshot.book_title || "",
    chapterTitle: snapshot.chapter_title || "Untitled chapter",
    coverUrl,
    authorName: profile?.pen_name || profile?.display_name || "A writer",
    authorAvatarUrl,
    scenes: (scenes ?? []).map((s) => ({ id: s.id, bodyHtml: s.body_html ?? "" })),
    chapters,
    isOwner: snapshot.owner_id === userId,
  };
}
