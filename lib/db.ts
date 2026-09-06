"use client";

/**
 * All Supabase data operations for Hot Cocoa.
 * Used by useHotCocoaDb hook — never call directly from components.
 */

import { createClient } from "./supabase/client";
import { Book, Section, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink, LibraryLink } from "./types";

const UNLOCK_THRESHOLDS = [1000, 2000, 5000, 10000, 25000];

// Label of the hidden section that holds each book's "info chapter" (Synopsis +
// Book-Info Library). Never rendered — the app filters this section out of
// everything author-facing, so its label is internal only.
const INFO_SECTION_LABEL = "__book_info__";

// TTL for library-file signed URLs. These expire, so the UI re-mints them on
// <img> error (see signLibraryImageUrl); a long TTL just keeps churn low for
// normal sessions. 24 hours.
const SIGNED_URL_TTL = 60 * 60 * 24;

function supabase() {
  return createClient();
}

// ── Book ──────────────────────────────────────────────────────────────────────

export interface BookSummary {
  id: string;
  title: string;
  coverImage?: string;
  coverImagePath?: string;
  wordCount: number;
  isActive: boolean;
}

// A cover_image_path is a bucket storage path (needs signing) unless it's a
// legacy inline cover (a data: URL) or an external http(s) URL — those are
// used verbatim. New covers are always storage paths.
function coverIsStoragePath(value: string | null | undefined): value is string {
  return !!value && !value.startsWith("data:") && !/^https?:/.test(value);
}

/** Batch-mint signed URLs for a set of library-files paths (one request, not
 *  N). Returns a path → signed-URL map; keyed by the path each entry reports,
 *  so it's robust to ordering. Shared by cover and library-image loading. */
async function signStoragePaths(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await supabase()
    .storage.from("library-files")
    .createSignedUrls(paths, SIGNED_URL_TTL);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

/** Re-mint a signed URL for a stored cover (mirrors signLibraryImageUrl). */
export async function signBookCoverUrl(path: string): Promise<string> {
  const { data } = await supabase()
    .storage.from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

/** Download the raw bytes of a stored library-files object (image or cover) via
 *  the authed storage client, for offline blob caching. Returns null on any
 *  failure (offline / missing) so callers can skip silently. */
export async function downloadStorageBlob(path: string): Promise<Blob | null> {
  const { data, error } = await supabase().storage.from("library-files").download(path);
  if (error || !data) return null;
  return data;
}

/** All of a user's books, most-recently-opened first. The first entry is the active book. */
export async function listBooks(userId: string): Promise<BookSummary[]> {
  const { data } = await supabase()
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  // Sign every stored cover in a single request rather than one-per-book.
  const signed = await signStoragePaths(
    rows.map((b) => b.cover_image_path).filter(coverIsStoragePath)
  );

  return rows.map((b, i) => {
    const raw = b.cover_image_path as string | null;
    return {
      id: b.id,
      title: b.title,
      coverImage: coverIsStoragePath(raw) ? signed.get(raw) : raw ?? undefined,
      coverImagePath: coverIsStoragePath(raw) ? raw : undefined,
      wordCount: b.word_count ?? 0,
      isActive: i === 0,
    };
  });
}

/** Create a new, empty book and make it the active one. Sections/chapters are
 *  bootstrapped lazily by getOrCreateBook when the book is first opened. */
export async function createBook(userId: string): Promise<BookSummary> {
  const { data, error } = await supabase()
    .from("books")
    .insert({ user_id: userId, title: "Untitled Book", last_opened_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    coverImage: data.cover_image_path ?? undefined,
    wordCount: 0,
    isActive: true,
  };
}

/** Mark a book as the active one (the book the Write page opens). */
export async function setActiveBook(bookId: string) {
  await supabase()
    .from("books")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", bookId);
}

export async function getOrCreateBook(userId: string): Promise<{
  book: Book;
  sections: Section[];
  infoChapter: Chapter;
}> {
  const db = supabase();

  const { data: books } = await db
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1);

  let dbBook = books?.[0];

  if (!dbBook) {
    const { data, error } = await db
      .from("books")
      .insert({ user_id: userId, title: "Untitled Book" })
      .select()
      .single();
    if (error) throw error;
    dbBook = data;
  }

  // Fetch sections
  const { data: dbSections } = await db
    .from("sections")
    .select("*")
    .eq("book_id", dbBook.id)
    .order("position", { ascending: true });

  let sectionsData = dbSections ?? [];

  // Fetch chapters
  const { data: dbChapters } = await db
    .from("chapters")
    .select("*")
    .eq("book_id", dbBook.id)
    .order("position", { ascending: true });

  let chaptersData = dbChapters ?? [];

  // Bootstrap: no sections yet — create default and assign chapters
  if (sectionsData.length === 0) {
    const { data: newSection, error } = await db
      .from("sections")
      .insert({ book_id: dbBook.id, label: "Chapters", position: 0 })
      .select()
      .single();
    if (error) throw error;
    sectionsData = [newSection];

    if (chaptersData.length > 0) {
      await db
        .from("chapters")
        .update({ section_id: newSection.id })
        .eq("book_id", dbBook.id);
      chaptersData = chaptersData.map((c) => ({ ...c, section_id: newSection.id }));
    }
  }

  // Bootstrap: no chapters — create default in first section
  if (chaptersData.length === 0) {
    const firstSection = sectionsData[0];
    const { data: newChapter, error } = await db
      .from("chapters")
      .insert({ book_id: dbBook.id, section_id: firstSection.id, title: "Chapter 1", position: 0 })
      .select()
      .single();
    if (error) throw error;
    await db.from("scenes").insert({ chapter_id: newChapter.id, label: "", body: "", position: 0 });
    chaptersData = [newChapter];
  }

  // ── Book Info: provision the hidden "info chapter" ──
  // It reuses the chapter/scene/library machinery to hold the Synopsis (its
  // single scene) and the Book-Info Library, but lives in a hidden section that
  // never surfaces in the Book Panel, word counts, exports, or backups.
  // chaptersData was fetched by book_id, so an existing info chapter is already
  // present here — we filter it (and its section) out of `sections` below.
  let infoChapterId = dbBook.info_chapter_id as string | null | undefined;
  let infoChapterRow = infoChapterId
    ? chaptersData.find((c) => c.id === infoChapterId)
    : undefined;
  if (!infoChapterId || !infoChapterRow) {
    const { data: hiddenSection, error: hsErr } = await db
      .from("sections")
      .insert({ book_id: dbBook.id, label: INFO_SECTION_LABEL, position: -1 })
      .select()
      .single();
    if (hsErr) throw hsErr;
    const { data: newInfoChapter, error: icErr } = await db
      .from("chapters")
      .insert({ book_id: dbBook.id, section_id: hiddenSection.id, title: "Book Info", position: 0 })
      .select()
      .single();
    if (icErr) throw icErr;
    await db.from("scenes").insert({ chapter_id: newInfoChapter.id, label: "", body: "", position: 0 });
    await db.from("books").update({ info_chapter_id: newInfoChapter.id }).eq("id", dbBook.id);
    infoChapterId = newInfoChapter.id;
    infoChapterRow = newInfoChapter;
    sectionsData.push(hiddenSection);
    chaptersData.push(newInfoChapter);
  }
  const infoSectionId = infoChapterRow.section_id as string;

  // Author-visible sections/chapters exclude the hidden info section entirely.
  // Match on label too, so a stray hidden section (e.g. from an interrupted
  // provisioning) can never surface in the Book Panel.
  const hiddenSectionIds = new Set(
    sectionsData.filter((s) => s.id === infoSectionId || s.label === INFO_SECTION_LABEL).map((s) => s.id)
  );
  const realSections = sectionsData.filter((s) => !hiddenSectionIds.has(s.id));
  const realChapters = chaptersData.filter(
    (c) => c.id !== infoChapterId && !hiddenSectionIds.has(c.section_id)
  );

  // Reopen the last-edited chapter if it still exists; else first real chapter.
  const savedActiveId = dbBook.active_chapter_id as string | null | undefined;
  const activeChapterId = realChapters.some((c) => c.id === savedActiveId)
    ? savedActiveId!
    : realChapters[0].id;

  const rawCover = dbBook.cover_image_path as string | null;
  const book: Book = {
    id: dbBook.id,
    title: dbBook.title,
    coverColor: dbBook.cover_color ?? "#2a2a2e",
    coverImage: coverIsStoragePath(rawCover)
      ? await signBookCoverUrl(rawCover)
      : rawCover ?? undefined,
    coverImagePath: coverIsStoragePath(rawCover) ? rawCover : undefined,
    activeChapterId,
    tags: (dbBook.tags as string[] | null) ?? [],
    infoChapterId: infoChapterId ?? undefined,
    excludedSectionIds: (dbBook.wordcount_excluded_sections as string[] | null) ?? [],
  };

  const sections: Section[] = realSections.map((s) => ({
    id: s.id,
    label: s.label,
    position: s.position,
    chapters: realChapters
      .filter((c) => c.section_id === s.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        sectionId: s.id,
        scenes: [],
        library: { images: [], notes: [], musicLinks: [], links: [] },
      })),
  }));

  const infoChapter: Chapter = {
    id: infoChapterRow.id,
    title: infoChapterRow.title,
    sectionId: infoSectionId,
    scenes: [],
    library: { images: [], notes: [], musicLinks: [], links: [] },
  };

  return { book, sections, infoChapter };
}

export async function updateBookTitle(bookId: string, title: string) {
  await supabase().from("books").update({ title }).eq("id", bookId);
}

export async function updateBookActiveChapter(bookId: string, chapterId: string) {
  await supabase().from("books").update({ active_chapter_id: chapterId }).eq("id", bookId);
}

/** Persist the book's selected Book Info tags (tag ids). */
export async function updateBookTags(bookId: string, tags: string[]) {
  await supabase().from("books").update({ tags }).eq("id", bookId);
}

/** Persist the sections excluded from the official Book Info word count. */
export async function updateBookExcludedSections(bookId: string, sectionIds: string[]) {
  await supabase()
    .from("books")
    .update({ wordcount_excluded_sections: sectionIds })
    .eq("id", bookId);
}

// ── Book stats ────────────────────────────────────────────────────────────────

export interface BookStats {
  createdAt: string;         // book created_at — the "since …" anchor
  sessionCount: number;      // distinct calendar days the author wrote
  totalActiveSeconds: number;
}

/** Read the daily-rollup stats backing Book Info: how many days the author has
 *  written (session count) and their summed active writing time. */
export async function getBookStats(bookId: string): Promise<BookStats | null> {
  const db = supabase();
  const [{ data: bookRow }, { data: days }] = await Promise.all([
    db.from("books").select("created_at").eq("id", bookId).maybeSingle(),
    db.from("writing_days").select("active_seconds").eq("book_id", bookId),
  ]);
  if (!bookRow) return null;
  const rows = days ?? [];
  return {
    createdAt: bookRow.created_at,
    sessionCount: rows.length,
    totalActiveSeconds: rows.reduce((t, r) => t + (r.active_seconds ?? 0), 0),
  };
}

/** Local (author-timezone) calendar day as YYYY-MM-DD — the writing_days key. */
function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Add active writing seconds to today's writing_days row (creating it — and so
 *  marking today as a writing day — if absent). Best-effort read-modify-write;
 *  small cross-tab races just lose a few seconds, which is fine for stats. */
export async function bumpWritingDay(userId: string, bookId: string, deltaSeconds: number) {
  if (deltaSeconds <= 0) return;
  const db = supabase();
  const day = localDayKey();
  const { data: existing } = await db
    .from("writing_days")
    .select("active_seconds")
    .eq("book_id", bookId)
    .eq("day", day)
    .maybeSingle();
  const active_seconds = (existing?.active_seconds ?? 0) + Math.round(deltaSeconds);
  await db
    .from("writing_days")
    .upsert(
      { user_id: userId, book_id: bookId, day, active_seconds },
      { onConflict: "book_id,day" }
    );
}

/** Set (or clear) the stored cover path/value on the book row. */
export async function updateBookCover(bookId: string, coverPath: string | null) {
  await supabase()
    .from("books")
    .update({ cover_image_path: coverPath })
    .eq("id", bookId);
}

/** Upload a cover image to the library-files bucket and return its storage
 *  path plus a ready-to-display signed URL. Path convention keeps covers under
 *  the owner's folder so the bucket's owner-scoped RLS applies. */
export async function uploadBookCover(
  userId: string,
  bookId: string,
  file: File
): Promise<{ path: string; signedUrl: string }> {
  const path = `${userId}/covers/${bookId}/${Date.now()}-${file.name}`;
  const db = supabase();

  const { error: uploadError } = await db.storage
    .from("library-files")
    .upload(path, file);
  if (uploadError) throw uploadError;

  const { data: signed } = await db.storage
    .from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);

  return { path, signedUrl: signed?.signedUrl ?? "" };
}

/** Remove a stored cover object. Legacy data-URL covers have no object, so
 *  callers should only pass a real storage path (see coverIsStoragePath). */
export async function removeBookCoverFile(path: string) {
  await supabase().storage.from("library-files").remove([path]);
}

export async function updateBookWordCount(bookId: string, wordCount: number, currentUnlocks: number[]) {
  const newUnlocks = UNLOCK_THRESHOLDS.filter(
    (t) => wordCount >= t && !currentUnlocks.includes(t)
  );
  const updatedUnlocks = [...currentUnlocks, ...newUnlocks];

  await supabase()
    .from("books")
    .update({
      word_count: wordCount,
      ...(newUnlocks.length > 0 ? { unlocks: updatedUnlocks } : {}),
    })
    .eq("id", bookId);

  return updatedUnlocks;
}

// ── Library storage cleanup ───────────────────────────────────────────────────

/** Storage paths of every stored library file under the given chapters. */
async function libraryFilePaths(chapterIds: string[]): Promise<string[]> {
  if (chapterIds.length === 0) return [];
  const { data } = await supabase()
    .from("library_items")
    .select("storage_path")
    .in("chapter_id", chapterIds)
    .not("storage_path", "is", null);
  return (data ?? []).map((item) => item.storage_path as string);
}

/** Best-effort removal of stored library files. Called after the owning rows
 *  are deleted — the rows are the source of truth, and a failed removal only
 *  leaves an orphaned object (never a broken reference). */
async function removeLibraryFiles(paths: string[]) {
  if (paths.length === 0) return;
  await supabase().storage.from("library-files").remove(paths);
}

// ── Sections ──────────────────────────────────────────────────────────────────

export async function createSection(bookId: string, position: number): Promise<Section> {
  const { data, error } = await supabase()
    .from("sections")
    .insert({ book_id: bookId, label: "New Section", position })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, label: data.label, position: data.position, chapters: [] };
}

export async function updateSectionLabel(sectionId: string, label: string) {
  await supabase().from("sections").update({ label }).eq("id", sectionId);
}

export async function reorderSections(sections: { id: string; position: number }[]) {
  const db = supabase();
  await Promise.all(
    sections.map((s) => db.from("sections").update({ position: s.position }).eq("id", s.id))
  );
}

export async function deleteSection(sectionId: string) {
  // Collect stored library files first — the cascade wipes the rows that
  // record their paths. Cascades: sections → chapters → scenes + library_items.
  const { data: chapters } = await supabase()
    .from("chapters")
    .select("id")
    .eq("section_id", sectionId);
  const paths = await libraryFilePaths((chapters ?? []).map((c) => c.id));
  await supabase().from("sections").delete().eq("id", sectionId);
  await removeLibraryFiles(paths);
}

// ── Chapters ──────────────────────────────────────────────────────────────────

export async function createChapter(bookId: string, sectionId: string, position: number): Promise<Chapter> {
  const { data, error } = await supabase()
    .from("chapters")
    .insert({ book_id: bookId, section_id: sectionId, title: `Chapter ${position + 1}`, position })
    .select()
    .single();
  if (error) throw error;

  await supabase().from("scenes").insert({
    chapter_id: data.id,
    label: "",
    body: "",
    position: 0,
  });

  return {
    id: data.id,
    title: data.title,
    sectionId,
    scenes: [],
    library: { images: [], notes: [], musicLinks: [], links: [] },
  };
}

export async function updateChapterTitle(chapterId: string, title: string) {
  await supabase().from("chapters").update({ title }).eq("id", chapterId);
}

export async function reorderChapters(chapters: { id: string; position: number }[]) {
  const db = supabase();
  await Promise.all(
    chapters.map((c) => db.from("chapters").update({ position: c.position }).eq("id", c.id))
  );
}

export async function deleteChapter(chapterId: string) {
  // Collect stored library files first — the cascade wipes the rows that
  // record their paths. Cascades: chapters → scenes + library_items.
  const paths = await libraryFilePaths([chapterId]);
  await supabase().from("chapters").delete().eq("id", chapterId);
  await removeLibraryFiles(paths);
}

// ── Scenes ────────────────────────────────────────────────────────────────────

export async function getScenesForChapter(chapterId: string): Promise<Scene[]> {
  const { data } = await supabase()
    .from("scenes")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("position", { ascending: true });

  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.label ?? "",
    body: s.body ?? "",
    updatedAt: s.updated_at,
    contentEditedAt: s.content_edited_at ?? undefined,
  }));
}

export async function createScene(
  chapterId: string,
  position: number,
  label = "",
  body = ""
): Promise<Scene> {
  const { data, error } = await supabase()
    .from("scenes")
    .insert({ chapter_id: chapterId, label, body, position })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, label, body, updatedAt: data.updated_at, contentEditedAt: data.content_edited_at ?? undefined };
}

export type SaveSceneResult =
  | { status: "saved"; updatedAt: string; contentEditedAt: string }
  // The server holds a newer (or equal) edit — the caller adopts `server` and
  // drops its own queued edit. No user prompt (see CONFLICT_SUNSET.md).
  | { status: "stale"; server: { label: string; body: string; updatedAt: string; contentEditedAt: string } }
  | { status: "deleted" };

// Last-write-wins save (see migration 021). `authoredAt` is the client's edit-time
// timestamp; the write applies only if it beats the row's `content_edited_at`, so
// the newest edit wins on whichever device made it — no cached base, no conflict
// class. A 0-row result means the server already has a newer-or-equal edit
// ("stale" → adopt it) or the scene is gone ("deleted"). A missing `authoredAt`
// (a pre-021 durable replay) falls back to now(), i.e. "treat as newest". Network
// errors still throw so the autosave loop can re-queue.
export async function saveScene(
  sceneId: string,
  patch: Partial<Pick<Scene, "label" | "body">>,
  authoredAt?: string | null
): Promise<SaveSceneResult> {
  const db = supabase();
  const stamp = authoredAt ?? new Date().toISOString();

  const { data, error } = await db
    .from("scenes")
    .update({ ...patch, content_edited_at: stamp })
    .eq("id", sceneId)
    // Win only if our edit is strictly newer than the row's. `.or` keeps a row
    // whose token is null (pre-backfill / brand-new) writable. The strict `<`
    // makes a re-sent write (same authoredAt, e.g. a lost-ack retry) a no-op that
    // reconciles silently rather than a spurious conflict.
    .or(`content_edited_at.is.null,content_edited_at.lt.${stamp}`)
    .select("updated_at, content_edited_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return { status: "saved", updatedAt: data.updated_at, contentEditedAt: data.content_edited_at };

  // Zero rows updated: the row has a newer-or-equal edit (stale) or it's gone.
  const { data: current, error: readErr } = await db
    .from("scenes")
    .select("label, body, updated_at, content_edited_at")
    .eq("id", sceneId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) return { status: "deleted" };
  return {
    status: "stale",
    server: {
      label: current.label ?? "",
      body: current.body ?? "",
      updatedAt: current.updated_at,
      contentEditedAt: current.content_edited_at,
    },
  };
}

// The server `updated_at` for each scene touched by a structural write (reorder /
// move / split). Returned for callers that want the post-write versions; the LWW
// save path no longer needs it (content saves win on their own authoredAt).
export type SceneVersion = { id: string; updatedAt: string };

function collectSceneVersions(
  results: { data: { id: string; updated_at: string }[] | null }[]
): SceneVersion[] {
  return results.flatMap((r) => (r.data ?? []).map((row) => ({ id: row.id, updatedAt: row.updated_at })));
}

// Reorder scenes within a chapter. Returns each touched scene's server
// `updated_at` so the caller can keep its concurrency base in sync — a
// position-only write no longer bumps updated_at (migration 020), but selecting
// it back lets the client trust the server value regardless of trigger behavior,
// which is what stops a drag-then-edit from throwing a false conflict.
export async function reorderScenes(
  scenes: { id: string; position: number }[]
): Promise<SceneVersion[]> {
  const db = supabase();
  const results = await Promise.all(
    scenes.map((s) =>
      db.from("scenes").update({ position: s.position }).eq("id", s.id).select("id, updated_at")
    )
  );
  return collectSceneVersions(results);
}

export async function deleteScene(sceneId: string) {
  await supabase().from("scenes").delete().eq("id", sceneId);
}

// Move a scene into a different chapter and renumber both lists. `toChapter` is
// the moved scene's new chapter; `fromPositions`/`toPositions` are the full
// 0..n position maps for the source and destination chapters *after* the move
// (the destination map includes the moved scene). Mirrors `reorderScenes`'
// parallel-update shape; the moved row's `chapter_id` is set in the same batch.
export async function moveScene(
  sceneId: string,
  toChapterId: string,
  fromPositions: { id: string; position: number }[],
  toPositions: { id: string; position: number }[]
): Promise<SceneVersion[]> {
  const db = supabase();
  const results = await Promise.all([
    db.from("scenes").update({ chapter_id: toChapterId }).eq("id", sceneId).select("id, updated_at"),
    ...fromPositions.map((s) =>
      db.from("scenes").update({ position: s.position }).eq("id", s.id).select("id, updated_at")
    ),
    ...toPositions.map((s) =>
      db.from("scenes").update({ position: s.position }).eq("id", s.id).select("id, updated_at")
    ),
  ]);
  return collectSceneVersions(results);
}

// Insert a chapter row WITHOUT the auto blank scene that `createChapter` adds —
// split and duplicate supply their own scenes. Returns a bare, sceneless chapter.
export async function insertChapterRow(
  bookId: string,
  sectionId: string,
  position: number,
  title: string
): Promise<Chapter> {
  const { data, error } = await supabase()
    .from("chapters")
    .insert({ book_id: bookId, section_id: sectionId, title, position })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title ?? "",
    sectionId,
    scenes: [],
    library: { images: [], notes: [], musicLinks: [], links: [] },
  };
}

// Bulk-insert copied scenes under a chapter (label/body/position), returning them
// with their freshly-minted ids so local state can match the DB. Used by
// duplicate-chapter. Preserves the given order via explicit positions.
export async function duplicateChapterScenes(
  chapterId: string,
  scenes: { label: string; body: string }[]
): Promise<Scene[]> {
  if (scenes.length === 0) return [];
  const rows = scenes.map((s, i) => ({ chapter_id: chapterId, label: s.label, body: s.body, position: i }));
  const { data, error } = await supabase().from("scenes").insert(rows).select();
  if (error) throw error;
  // insert().select() doesn't guarantee input order — sort by position.
  return (data ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, label: s.label ?? "", body: s.body ?? "", updatedAt: s.updated_at, contentEditedAt: s.content_edited_at ?? undefined }));
}

// Split: reparent `movedSceneIds` onto the new chapter and renumber both lists.
// `sourcePositions`/`movedPositions` are the full 0..n maps after the split.
// Mirrors `moveScene`, but moves several scenes at once.
export async function splitChapter(
  newChapterId: string,
  movedSceneIds: string[],
  sourcePositions: { id: string; position: number }[],
  movedPositions: { id: string; position: number }[]
): Promise<SceneVersion[]> {
  const db = supabase();
  const results = await Promise.all([
    ...movedSceneIds.map((id) =>
      db.from("scenes").update({ chapter_id: newChapterId }).eq("id", id).select("id, updated_at")
    ),
    ...sourcePositions.map((s) =>
      db.from("scenes").update({ position: s.position }).eq("id", s.id).select("id, updated_at")
    ),
    ...movedPositions.map((s) =>
      db.from("scenes").update({ position: s.position }).eq("id", s.id).select("id, updated_at")
    ),
  ]);
  return collectSceneVersions(results);
}

// Move a chapter into a different section and renumber both sections. Mirrors
// `moveScene` at the chapter/section level.
export async function moveChapter(
  chapterId: string,
  toSectionId: string,
  fromPositions: { id: string; position: number }[],
  toPositions: { id: string; position: number }[]
) {
  const db = supabase();
  await Promise.all([
    db.from("chapters").update({ section_id: toSectionId }).eq("id", chapterId),
    ...fromPositions.map((c) => db.from("chapters").update({ position: c.position }).eq("id", c.id)),
    ...toPositions.map((c) => db.from("chapters").update({ position: c.position }).eq("id", c.id)),
  ]);
}

// Persist a new ordering for library items (images, music links, or notes).
// Positions are per-type within a chapter, mirroring how items are appended.
export async function reorderLibraryItems(items: { id: string; position: number }[]) {
  const db = supabase();
  await Promise.all(
    items.map((it) => db.from("library_items").update({ position: it.position }).eq("id", it.id))
  );
}

// ── Library ───────────────────────────────────────────────────────────────────

export async function getLibraryForChapter(chapterId: string): Promise<{
  images: LibraryImage[];
  notes: LibraryNote[];
  musicLinks: LibraryMusicLink[];
  links: LibraryLink[];
}> {
  const { data } = await supabase()
    .from("library_items")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("position", { ascending: true });

  const items = data ?? [];
  const images: LibraryImage[] = [];
  const notes: LibraryNote[] = [];
  const musicLinks: LibraryMusicLink[] = [];
  const links: LibraryLink[] = [];

  // Sign every stored image in one request rather than awaiting one per image.
  const signed = await signStoragePaths(
    items.filter((it) => it.type === "image" && it.storage_path).map((it) => it.storage_path)
  );

  for (const item of items) {
    if (item.type === "image") {
      // Stored images get a signed URL; images added as an external URL use it.
      const dataUrl = item.storage_path ? signed.get(item.storage_path) ?? "" : item.url ?? "";
      images.push({
        id: item.id,
        name: item.filename ?? "",
        dataUrl,
        path: item.storage_path ?? undefined,
      });
    } else if (item.type === "text") {
      notes.push({
        id: item.id,
        title: item.og_title ?? "",
        body: item.og_description ?? "",
        position: item.position ?? 0,
      });
    } else if (item.type === "music") {
      musicLinks.push({
        id: item.id,
        url: item.url ?? "",
        title: item.og_title ?? "",
        description: item.og_description ?? "",
        image: item.og_image ?? "",
      });
    } else if (item.type === "link") {
      links.push({
        id: item.id,
        url: item.url ?? "",
        title: item.og_title ?? "",
        siteName: item.og_description ?? "",
        favicon: item.og_image ?? "",
      });
    }
  }

  return { images, notes, musicLinks, links };
}

export async function addLibraryImage(
  chapterId: string,
  userId: string,
  file: File,
  position: number
): Promise<LibraryImage> {
  const path = `${userId}/${chapterId}/images/${Date.now()}-${file.name}`;
  const db = supabase();

  const { error: uploadError } = await db.storage
    .from("library-files")
    .upload(path, file);
  if (uploadError) throw uploadError;

  const { data, error } = await db
    .from("library_items")
    .insert({
      chapter_id: chapterId,
      type: "image",
      storage_path: path,
      filename: file.name,
      position,
    })
    .select()
    .single();
  if (error) throw error;

  const { data: signed } = await db.storage
    .from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);

  return {
    id: data.id,
    name: file.name,
    dataUrl: signed?.signedUrl ?? "",
    path,
  };
}

// Re-mint a signed URL for a stored library image. Called by the UI when an
// image's signed URL has expired (the <img> fails to load).
export async function signLibraryImageUrl(path: string): Promise<string> {
  const { data } = await supabase()
    .storage.from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

export async function addLibraryImageFromDataUrl(
  chapterId: string,
  userId: string,
  dataUrl: string,
  filename: string,
  position: number
): Promise<LibraryImage> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });
  return addLibraryImage(chapterId, userId, file, position);
}

export async function removeLibraryItem(itemId: string, storagePath?: string) {
  const db = supabase();
  if (storagePath) {
    await db.storage.from("library-files").remove([storagePath]);
  }
  await db.from("library_items").delete().eq("id", itemId);
}

export async function addNote(
  chapterId: string,
  note: { title: string; body: string },
  position: number
): Promise<LibraryNote> {
  const { data, error } = await supabase()
    .from("library_items")
    .insert({
      chapter_id: chapterId,
      type: "text",
      og_title: note.title,
      og_description: note.body,
      position,
    })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, title: note.title, body: note.body, position };
}

export async function updateNote(
  noteId: string,
  patch: { title?: string; body?: string }
) {
  const update: Record<string, string> = {};
  if (patch.title !== undefined) update.og_title = patch.title;
  if (patch.body !== undefined) update.og_description = patch.body;
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase().from("library_items").update(update).eq("id", noteId);
  if (error) throw error;
}

export async function addMusicLink(
  chapterId: string,
  link: Omit<LibraryMusicLink, "id">,
  position: number
): Promise<LibraryMusicLink> {
  const { data, error } = await supabase()
    .from("library_items")
    .insert({
      chapter_id: chapterId,
      type: "music",
      url: link.url,
      og_title: link.title,
      og_description: link.description,
      og_image: link.image,
      position,
    })
    .select()
    .single();
  if (error) throw error;

  return { id: data.id, ...link };
}

export async function addLink(
  chapterId: string,
  link: Omit<LibraryLink, "id">,
  position: number
): Promise<LibraryLink> {
  const { data, error } = await supabase()
    .from("library_items")
    .insert({
      chapter_id: chapterId,
      type: "link",
      url: link.url,
      og_title: link.title,
      og_description: link.siteName,
      og_image: link.favicon,
      position,
    })
    .select()
    .single();
  if (error) throw error;

  return { id: data.id, ...link };
}

// ── Book deletion ───────────────────────────────────────────────────────────────

/** Permanently delete a book. Sections/chapters/scenes/library cascade via FKs,
 *  then the chapters' stored library files are removed from Storage.
 *  The book's `backups` rows are preserved (backups.book_id is ON DELETE SET NULL),
 *  so a deleted book can still be restored from an existing backup. */
export async function deleteBook(bookId: string) {
  const [{ data: chapters }, { data: book }] = await Promise.all([
    supabase().from("chapters").select("id").eq("book_id", bookId),
    supabase().from("books").select("cover_image_path").eq("id", bookId).single(),
  ]);
  const paths = await libraryFilePaths((chapters ?? []).map((c) => c.id));
  // The book's uploaded cover lives in the same bucket but isn't a library_item.
  if (coverIsStoragePath(book?.cover_image_path)) paths.push(book!.cover_image_path);
  await supabase().from("books").delete().eq("id", bookId);
  await removeLibraryFiles(paths);
}

// ── Backups ─────────────────────────────────────────────────────────────────────

export type BackupCadence = "off" | "daily" | "weekly";

export interface BackupSummary {
  id: string;
  bookId: string | null;
  bookTitle: string;
  storagePath: string;
  sizeBytes: number;
  trigger: "manual" | "auto";
  status: "complete" | "failed";
  createdAt: string;
}

/** All of a user's backups across every book, newest first. */
export async function listBackups(userId: string): Promise<BackupSummary[]> {
  const { data } = await supabase()
    .from("backups")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((b) => ({
    id: b.id,
    bookId: b.book_id ?? null,
    bookTitle: b.book_title ?? "Untitled",
    storagePath: b.storage_path,
    sizeBytes: b.size_bytes ?? 0,
    trigger: b.trigger,
    status: b.status,
    createdAt: b.created_at,
  }));
}

/** The active (most-recently-opened) book plus its auto-backup cadence,
 *  used by the Backups page for the "Back up now" target and cadence control. */
export async function getActiveBookMeta(
  userId: string
): Promise<{ id: string; title: string; cadence: BackupCadence } | null> {
  const { data } = await supabase()
    .from("books")
    .select("id, title, auto_backup_cadence")
    .eq("user_id", userId)
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1);

  const book = data?.[0];
  if (!book) return null;
  return {
    id: book.id,
    title: book.title ?? "Untitled",
    cadence: (book.auto_backup_cadence ?? "off") as BackupCadence,
  };
}

export async function setBookCadence(bookId: string, cadence: BackupCadence) {
  await supabase().from("books").update({ auto_backup_cadence: cadence }).eq("id", bookId);
}

/** Re-mint a signed download URL for a backup ZIP (mirrors signLibraryImageUrl). */
export async function signBackupUrl(storagePath: string): Promise<string> {
  const { data } = await supabase()
    .storage.from("book-backups")
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

/** Delete a backup: both the DB row and its Storage object. */
export async function deleteBackup(id: string, storagePath: string) {
  const db = supabase();
  await db.storage.from("book-backups").remove([storagePath]);
  await db.from("backups").delete().eq("id", id);
}

// ── Exports ───────────────────────────────────────────────────────────────────────

export interface ExportSummary {
  id: string;
  bookId: string | null;
  bookTitle: string;
  storagePath: string;
  sizeBytes: number;
  kind: "full" | "partial";
  chapterCount: number;
  createdAt: string;
}

/** A chapter in a book, in reading order — used by the export page's chapter picker. */
export interface ChapterRef {
  id: string;
  title: string;
  sectionLabel: string;
}

/** All of a user's manuscript exports across every book, newest first. */
export async function listExports(userId: string): Promise<ExportSummary[]> {
  const { data } = await supabase()
    .from("exports")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((e) => ({
    id: e.id,
    bookId: e.book_id ?? null,
    bookTitle: e.book_title ?? "Untitled",
    storagePath: e.storage_path,
    sizeBytes: e.size_bytes ?? 0,
    kind: (e.kind ?? "full") as "full" | "partial",
    chapterCount: e.chapter_count ?? 0,
    createdAt: e.created_at,
  }));
}

/** Chapters of a book in reading order (section position, then chapter position). */
export async function listChaptersForBook(bookId: string): Promise<ChapterRef[]> {
  const db = supabase();
  const [{ data: sections }, { data: chapters }] = await Promise.all([
    db.from("sections").select("id, label, position").eq("book_id", bookId).order("position"),
    db.from("chapters").select("id, title, section_id, position").eq("book_id", bookId).order("position"),
  ]);

  const refs: ChapterRef[] = [];
  for (const s of sections ?? []) {
    for (const c of chapters ?? []) {
      if (c.section_id === s.id) {
        refs.push({ id: c.id, title: c.title ?? "Untitled Chapter", sectionLabel: s.label ?? "" });
      }
    }
  }
  // Include any chapter not matched to a section (shouldn't happen) at the end.
  for (const c of chapters ?? []) {
    if (!refs.some((r) => r.id === c.id)) {
      refs.push({ id: c.id, title: c.title ?? "Untitled Chapter", sectionLabel: "" });
    }
  }
  return refs;
}

/** Re-mint a signed download URL for an export .docx (mirrors signBackupUrl). */
export async function signExportUrl(storagePath: string): Promise<string> {
  const { data } = await supabase()
    .storage.from("book-exports")
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

/** Delete an export: both the DB row and its Storage object. */
export async function deleteExport(id: string, storagePath: string) {
  const db = supabase();
  await db.storage.from("book-exports").remove([storagePath]);
  await db.from("exports").delete().eq("id", id);
}
