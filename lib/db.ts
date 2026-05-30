"use client";

/**
 * All Supabase data operations for Akuko.
 * Used by useAkukoDb hook — never call directly from components.
 */

import { createClient } from "./supabase/client";
import { Book, Chapter, Scene, LibraryImage, LibraryFile, LibraryMusicLink } from "./types";

const UNLOCK_THRESHOLDS = [1000, 2000, 5000, 10000, 25000];

// ── Helpers ───────────────────────────────────────────────────────────────────

function supabase() {
  return createClient();
}

// ── Book ──────────────────────────────────────────────────────────────────────

export async function getOrCreateBook(userId: string): Promise<{
  book: Book;
  chapters: Chapter[];
}> {
  const db = supabase();

  // Try to fetch existing book
  const { data: books } = await db
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  let dbBook = books?.[0];

  if (!dbBook) {
    // Create default book
    const { data, error } = await db
      .from("books")
      .insert({ user_id: userId, title: "Untitled Book" })
      .select()
      .single();
    if (error) throw error;
    dbBook = data;
  }

  // Fetch chapters
  const { data: dbChapters } = await db
    .from("chapters")
    .select("*")
    .eq("book_id", dbBook.id)
    .order("position", { ascending: true });

  let chapters = dbChapters ?? [];

  if (chapters.length === 0) {
    // Create default chapter
    const { data, error } = await db
      .from("chapters")
      .insert({ book_id: dbBook.id, title: "Chapter 1", position: 0 })
      .select()
      .single();
    if (error) throw error;
    chapters = [data];

    // Create default scene for that chapter
    await db.from("scenes").insert({
      chapter_id: data.id,
      label: "",
      body: "",
      position: 0,
    });
  }

  const book: Book = {
    id: dbBook.id,
    title: dbBook.title,
    coverColor: dbBook.cover_color ?? "#2a2a2e",
    coverImage: dbBook.cover_image_url ?? undefined,
    chapters: [],
    activeChapterId: chapters[0].id,
  };

  const mappedChapters: Chapter[] = chapters.map((c) => ({
    id: c.id,
    title: c.title,
    scenes: [],
    library: { images: [], files: [], musicLinks: [] },
  }));

  return { book, chapters: mappedChapters };
}

export async function updateBookTitle(bookId: string, title: string) {
  await supabase().from("books").update({ title }).eq("id", bookId);
}

export async function updateBookCover(bookId: string, coverImageUrl: string | undefined) {
  await supabase()
    .from("books")
    .update({ cover_image_url: coverImageUrl ?? null })
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

// ── Chapters ──────────────────────────────────────────────────────────────────

export async function createChapter(bookId: string, position: number): Promise<Chapter> {
  const { data, error } = await supabase()
    .from("chapters")
    .insert({ book_id: bookId, title: `Chapter ${position + 1}`, position })
    .select()
    .single();
  if (error) throw error;

  // Create a default scene
  await supabase().from("scenes").insert({
    chapter_id: data.id,
    label: "",
    body: "",
    position: 0,
  });

  return {
    id: data.id,
    title: data.title,
    scenes: [],
    library: { images: [], files: [], musicLinks: [] },
  };
}

export async function updateChapterTitle(chapterId: string, title: string) {
  await supabase().from("chapters").update({ title }).eq("id", chapterId);
}

export async function reorderChapters(
  chapters: { id: string; position: number }[]
) {
  const db = supabase();
  await Promise.all(
    chapters.map((c) =>
      db.from("chapters").update({ position: c.position }).eq("id", c.id)
    )
  );
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

// ── Library ───────────────────────────────────────────────────────────────────

export async function getLibraryForChapter(chapterId: string): Promise<{
  images: LibraryImage[];
  files: LibraryFile[];
  musicLinks: LibraryMusicLink[];
}> {
  const { data } = await supabase()
    .from("library_items")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("position", { ascending: true });

  const items = data ?? [];
  const images: LibraryImage[] = [];
  const files: LibraryFile[] = [];
  const musicLinks: LibraryMusicLink[] = [];

  for (const item of items) {
    if (item.type === "image") {
      // Generate signed URL for private storage
      let dataUrl = item.url ?? "";
      if (item.storage_path) {
        const { data: signed } = await supabase()
          .storage.from("library-files")
          .createSignedUrl(item.storage_path, 3600);
        dataUrl = signed?.signedUrl ?? "";
      }
      images.push({ id: item.id, name: item.filename ?? "", dataUrl });
    } else if (item.type === "text") {
      let content = "";
      if (item.storage_path) {
        const { data: blob } = await supabase()
          .storage.from("library-files")
          .download(item.storage_path);
        if (blob) content = await blob.text();
      }
      files.push({ id: item.id, name: item.filename ?? "", content });
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

  return { images, files, musicLinks };
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
    .createSignedUrl(path, 3600);

  return {
    id: data.id,
    name: file.name,
    dataUrl: signed?.signedUrl ?? "",
  };
}

export async function addLibraryImageFromDataUrl(
  chapterId: string,
  userId: string,
  dataUrl: string,
  filename: string,
  position: number
): Promise<LibraryImage> {
  // Convert data URL to blob
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

export async function addLibraryFile(
  chapterId: string,
  userId: string,
  file: File,
  position: number
): Promise<LibraryFile> {
  const path = `${userId}/${chapterId}/files/${Date.now()}-${file.name}`;
  const db = supabase();

  const { error: uploadError } = await db.storage
    .from("library-files")
    .upload(path, file);
  if (uploadError) throw uploadError;

  const { data, error } = await db
    .from("library_items")
    .insert({
      chapter_id: chapterId,
      type: "text",
      storage_path: path,
      filename: file.name,
      position,
    })
    .select()
    .single();
  if (error) throw error;

  const content = await file.text();
  return { id: data.id, name: file.name, content };
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
