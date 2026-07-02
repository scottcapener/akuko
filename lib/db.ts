"use client";

/**
 * All Supabase data operations for Hot Cocoa.
 * Used by useHotCocoaDb hook — never call directly from components.
 */

import { createClient } from "./supabase/client";
import { Book, Section, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink } from "./types";

const UNLOCK_THRESHOLDS = [1000, 2000, 5000, 10000, 25000];

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
  wordCount: number;
  isActive: boolean;
}

/** All of a user's books, most-recently-opened first. The first entry is the active book. */
export async function listBooks(userId: string): Promise<BookSummary[]> {
  const { data } = await supabase()
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });

  return (data ?? []).map((b, i) => ({
    id: b.id,
    title: b.title,
    coverImage: b.cover_image_path ?? undefined,
    wordCount: b.word_count ?? 0,
    isActive: i === 0,
  }));
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

  // Reopen the last-edited chapter if it still exists; else first chapter.
  const savedActiveId = dbBook.active_chapter_id as string | null | undefined;
  const activeChapterId = chaptersData.some((c) => c.id === savedActiveId)
    ? savedActiveId!
    : chaptersData[0].id;

  const book: Book = {
    id: dbBook.id,
    title: dbBook.title,
    coverColor: dbBook.cover_color ?? "#2a2a2e",
    coverImage: dbBook.cover_image_path ?? undefined,
    activeChapterId,
  };

  const sections: Section[] = sectionsData.map((s) => ({
    id: s.id,
    label: s.label,
    position: s.position,
    chapters: chaptersData
      .filter((c) => c.section_id === s.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        sectionId: s.id,
        scenes: [],
        library: { images: [], notes: [], musicLinks: [] },
      })),
  }));

  return { book, sections };
}

export async function updateBookTitle(bookId: string, title: string) {
  await supabase().from("books").update({ title }).eq("id", bookId);
}

export async function updateBookActiveChapter(bookId: string, chapterId: string) {
  await supabase().from("books").update({ active_chapter_id: chapterId }).eq("id", bookId);
}

export async function updateBookCover(bookId: string, coverImageUrl: string | undefined) {
  await supabase()
    .from("books")
    .update({ cover_image_path: coverImageUrl ?? null })
    .eq("id", bookId);
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
  // Cascades: sections → chapters → scenes + library_items
  await supabase().from("sections").delete().eq("id", sectionId);
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
    library: { images: [], notes: [], musicLinks: [] },
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
  // Cascades: chapters → scenes + library_items
  await supabase().from("chapters").delete().eq("id", chapterId);
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
  }));
}

export async function createScene(chapterId: string, position: number): Promise<Scene> {
  const { data, error } = await supabase()
    .from("scenes")
    .insert({ chapter_id: chapterId, label: "", body: "", position })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, label: "", body: "" };
}

export async function saveScene(sceneId: string, patch: Partial<Pick<Scene, "label" | "body">>) {
  await supabase()
    .from("scenes")
    .update({ ...patch })
    .eq("id", sceneId);
}

export async function reorderScenes(scenes: { id: string; position: number }[]) {
  const db = supabase();
  await Promise.all(
    scenes.map((s) => db.from("scenes").update({ position: s.position }).eq("id", s.id))
  );
}

export async function deleteScene(sceneId: string) {
  await supabase().from("scenes").delete().eq("id", sceneId);
}

// ── Library ───────────────────────────────────────────────────────────────────

export async function getLibraryForChapter(chapterId: string): Promise<{
  images: LibraryImage[];
  notes: LibraryNote[];
  musicLinks: LibraryMusicLink[];
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

  for (const item of items) {
    if (item.type === "image") {
      let dataUrl = item.url ?? "";
      if (item.storage_path) {
        const { data: signed } = await supabase()
          .storage.from("library-files")
          .createSignedUrl(item.storage_path, SIGNED_URL_TTL);
        dataUrl = signed?.signedUrl ?? "";
      }
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
    }
  }

  return { images, notes, musicLinks };
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
  await supabase().from("library_items").update(update).eq("id", noteId);
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
