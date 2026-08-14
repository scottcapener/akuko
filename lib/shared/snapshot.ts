import type { SupabaseClient } from "@supabase/supabase-js";
import sanitizeHtml from "sanitize-html";
import { sanitizeProseHtml } from "@/lib/sanitize";

// Server-only. Snapshots one live chapter into the Shared With You tables
// (see SHARED_WITH_YOU.md §1). Called under the AUTHOR's session, so the
// "own …" RLS policies confine every live read to the caller's own rows and
// the "owner writes" policies confine every snapshot write. Reused for both
// first-share and "Update shared copy" (§7) — it upserts shared_chapters on the
// UNIQUE(chapter_id) key and reconciles shared_scenes IN PLACE by scene_id, so a
// re-share is idempotent, lands in place, and preserves the comments anchored to
// those scenes.
//
// The snapshot copies the *text* (sanitized), plus a copy of book identity
// (title, cover, position) so the recipient renders the chapter without ever
// reading the author's live book/chapter/scene rows.

/** Plain-text projection of a sanitized scene body. Stage-2 comment offsets
 *  index into this, so it must be a stable function of body_html: block breaks
 *  and <br> become newlines, all tags are dropped, entities decoded. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SnapshotResult {
  sharedChapterId: string;
  /** true when this call created the snapshot, false when it re-shared. */
  created: boolean;
}

/**
 * Create or refresh the snapshot for `chapterId`. Returns the shared_chapters
 * id. Throws if the chapter can't be read (not the caller's, or missing).
 */
export async function snapshotChapter(
  supabase: SupabaseClient,
  chapterId: string,
  ownerId: string
): Promise<SnapshotResult> {
  // ── Read the live chapter (RLS: caller must own it) ──
  const { data: chapter, error: chErr } = await supabase
    .from("chapters")
    .select("id, book_id, section_id, title, position")
    .eq("id", chapterId)
    .single();
  if (chErr || !chapter) {
    throw new Error("Chapter not found");
  }

  // ── Book identity to snapshot ──
  const { data: book } = await supabase
    .from("books")
    .select("id, title, cover_image_path")
    .eq("id", chapter.book_id)
    .single();

  // ── book_position: the chapter's index in the book's flattened order
  //    (sections by position, then chapters by position). A snapshot value —
  //    if the author reorders later, it only updates on the next re-share. ──
  const bookPosition = await computeBookPosition(supabase, chapter.book_id, chapterId);

  // ── Scenes, in order ──
  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, body, position")
    .eq("chapter_id", chapterId)
    .order("position", { ascending: true });

  // ── Upsert the snapshot row on UNIQUE(chapter_id) ──
  const { data: existing } = await supabase
    .from("shared_chapters")
    .select("id")
    .eq("chapter_id", chapterId)
    .maybeSingle();

  const snapshotRow = {
    chapter_id: chapterId,
    owner_id: ownerId,
    book_id: chapter.book_id,
    book_title: book?.title ?? "",
    cover_path: book?.cover_image_path ?? null,
    chapter_title: chapter.title ?? "",
    book_position: bookPosition,
    updated_at: new Date().toISOString(),
    unshared_at: null,
  };

  // ── Scene snapshot rows: sanitize the HTML, derive the text projection ──
  const sceneRows = (scenes ?? []).map((s, i) => {
    const bodyHtml = sanitizeProseHtml(s.body ?? "");
    return {
      scene_id: s.id as string,
      position: (s.position as number | null) ?? i,
      body_html: bodyHtml,
      body_text: htmlToText(bodyHtml),
    };
  });

  let sharedChapterId: string;
  if (existing) {
    sharedChapterId = existing.id;
    const { error } = await supabase
      .from("shared_chapters")
      .update(snapshotRow)
      .eq("id", sharedChapterId);
    if (error) throw error;

    // Re-share updates shared_scenes IN PLACE, keyed by scene_id, so each row
    // keeps its id and the comments anchored to it survive (§7) — a wholesale
    // delete+reinsert would cascade every comment away. Scenes still present are
    // updated; newly-added scenes inserted; scenes removed from the live chapter
    // are deleted (their comments go with the scene).
    const { data: prior } = await supabase
      .from("shared_scenes")
      .select("id, scene_id")
      .eq("shared_chapter_id", sharedChapterId);
    const priorIdByScene = new Map(
      (prior ?? []).map((p) => [p.scene_id as string | null, p.id as string])
    );
    const liveSceneIds = new Set(sceneRows.map((r) => r.scene_id));

    const orphans = (prior ?? [])
      .filter((p) => !liveSceneIds.has(p.scene_id as string))
      .map((p) => p.id as string);
    if (orphans.length) {
      await supabase.from("shared_scenes").delete().in("id", orphans);
    }

    const newRows: Record<string, unknown>[] = [];
    for (const r of sceneRows) {
      const priorId = priorIdByScene.get(r.scene_id);
      if (priorId) {
        const { error: uErr } = await supabase
          .from("shared_scenes")
          .update({ position: r.position, body_html: r.body_html, body_text: r.body_text })
          .eq("id", priorId);
        if (uErr) throw uErr;
      } else {
        newRows.push({ shared_chapter_id: sharedChapterId, ...r });
      }
    }
    if (newRows.length) {
      const { error: iErr } = await supabase.from("shared_scenes").insert(newRows);
      if (iErr) throw iErr;
    }
  } else {
    const { data: inserted, error } = await supabase
      .from("shared_chapters")
      .insert(snapshotRow)
      .select("id")
      .single();
    if (error || !inserted) throw error ?? new Error("Failed to create snapshot");
    sharedChapterId = inserted.id;

    const rows = sceneRows.map((r) => ({ shared_chapter_id: sharedChapterId, ...r }));
    if (rows.length) {
      const { error: sErr } = await supabase.from("shared_scenes").insert(rows);
      if (sErr) throw sErr;
    }
  }

  return { sharedChapterId, created: !existing };
}

/** Index of `chapterId` in the book's flattened chapter order. */
async function computeBookPosition(
  supabase: SupabaseClient,
  bookId: string,
  chapterId: string
): Promise<number> {
  const [{ data: sections }, { data: chapters }] = await Promise.all([
    supabase.from("sections").select("id, position").eq("book_id", bookId),
    supabase.from("chapters").select("id, section_id, position").eq("book_id", bookId),
  ]);

  const sectionOrder = new Map<string, number>();
  (sections ?? []).forEach((s) => sectionOrder.set(s.id, s.position ?? 0));

  const ordered = (chapters ?? []).slice().sort((a, b) => {
    // Chapters with no section sort last, in a stable, deterministic spot.
    const sa = a.section_id != null ? sectionOrder.get(a.section_id) ?? Infinity : Infinity;
    const sb = b.section_id != null ? sectionOrder.get(b.section_id) ?? Infinity : Infinity;
    if (sa !== sb) return sa - sb;
    return (a.position ?? 0) - (b.position ?? 0);
  });

  const idx = ordered.findIndex((c) => c.id === chapterId);
  return idx < 0 ? 0 : idx;
}
