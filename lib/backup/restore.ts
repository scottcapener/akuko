"use client";

/**
 * Client-side restore. Downloads a backup ZIP, parses its manifest, and
 * rebuilds it as a BRAND-NEW book (new ids for every row) — it never
 * touches an existing book. Works identically whether the source book
 * still exists or was deleted (that's the point of the nullable book_id).
 */

import { unzipSync, strFromU8 } from "fflate";
import { createClient } from "../supabase/client";
import { signBackupUrl } from "../db";
import {
  SCHEMA_VERSION,
  MANIFEST_FILENAME,
  type BackupManifest,
} from "./manifest";

const LIBRARY_BUCKET = "library-files";

export class UnsupportedBackupError extends Error {}

/**
 * Restore a backup into a new book owned by `userId`. Returns the new book id.
 * Throws UnsupportedBackupError if the manifest's schema version is newer than
 * this build understands.
 */
export async function restoreBackup(
  userId: string,
  storagePath: string
): Promise<string> {
  const db = createClient();

  // ── Download + unzip ───────────────────────────────────────────────
  const url = await signBackupUrl(storagePath);
  if (!url) throw new Error("Could not locate this backup's file.");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to download the backup file.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(bytes);

  const manifestBytes = files[MANIFEST_FILENAME];
  if (!manifestBytes) throw new Error("Backup is missing its manifest.");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest;

  if (typeof manifest.schemaVersion !== "number") {
    throw new UnsupportedBackupError("This backup is not in a recognized format.");
  }
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedBackupError(
      "This backup was made by a newer version of Hot Cocoa and can't be restored here."
    );
  }

  // ── New ids for everything ─────────────────────────────────────────
  const newBookId = crypto.randomUUID();
  const sectionIdMap = new Map<string, string>();
  const chapterIdMap = new Map<string, string>();
  for (const s of manifest.sections) sectionIdMap.set(s.id, crypto.randomUUID());
  for (const c of manifest.chapters) chapterIdMap.set(c.id, crypto.randomUUID());

  // ── Cover ──────────────────────────────────────────────────────────
  // v2 backups bundle the cover blob: re-upload it to the restored book's own
  // Storage path. v1 backups carry a data/http URL, copied as-is.
  let coverPath: string | null = manifest.book.coverImagePath ?? null;
  if (manifest.book.coverImageFile) {
    const coverBytes = files[manifest.book.coverImageFile];
    if (coverBytes) {
      const path = `${userId}/covers/${newBookId}/${Date.now()}-cover`;
      const { error: coverErr } = await db.storage
        .from(LIBRARY_BUCKET)
        .upload(
          path,
          new Blob([coverBytes.slice()], {
            type: manifest.book.coverContentType || "application/octet-stream",
          }),
          { contentType: manifest.book.coverContentType || undefined }
        );
      if (!coverErr) coverPath = path;
    }
  }

  // ── Book ───────────────────────────────────────────────────────────
  const { error: bookErr } = await db.from("books").insert({
    id: newBookId,
    user_id: userId,
    title: `${manifest.book.title} (Restored)`,
    cover_color: manifest.book.coverColor,
    cover_image_path: coverPath,
    word_count: manifest.book.wordCount,
    unlocks: manifest.book.unlocks,
  });
  if (bookErr) throw bookErr;

  // ── Sections ───────────────────────────────────────────────────────
  if (manifest.sections.length) {
    const { error } = await db.from("sections").insert(
      manifest.sections.map((s) => ({
        id: sectionIdMap.get(s.id),
        book_id: newBookId,
        label: s.label,
        position: s.position,
      }))
    );
    if (error) throw error;
  }

  // ── Chapters ───────────────────────────────────────────────────────
  const orderedChapters = [...manifest.chapters].sort((a, b) => a.position - b.position);
  if (orderedChapters.length) {
    const { error } = await db.from("chapters").insert(
      orderedChapters
        .filter((c) => sectionIdMap.has(c.sectionId))
        .map((c) => ({
          id: chapterIdMap.get(c.id),
          book_id: newBookId,
          section_id: sectionIdMap.get(c.sectionId),
          title: c.title,
          position: c.position,
        }))
    );
    if (error) throw error;
  }

  // ── Scenes ─────────────────────────────────────────────────────────
  const sceneRows = manifest.scenes
    .filter((s) => chapterIdMap.has(s.chapterId))
    .map((s) => ({
      chapter_id: chapterIdMap.get(s.chapterId),
      label: s.label,
      body: s.body,
      position: s.position,
    }));
  if (sceneRows.length) {
    const { error } = await db.from("scenes").insert(sceneRows);
    if (error) throw error;
  }

  // ── Library items (re-upload bundled images to library-files) ───────
  const libraryRows: Record<string, unknown>[] = [];
  for (const item of manifest.libraryItems) {
    const chapterId = chapterIdMap.get(item.chapterId);
    if (!chapterId) continue;

    const row: Record<string, unknown> = {
      chapter_id: chapterId,
      type: item.type,
      position: item.position,
    };

    if (item.type === "image") {
      const blobBytes = item.imageFile ? files[item.imageFile] : undefined;
      if (blobBytes) {
        const path = `${userId}/${chapterId}/images/${Date.now()}-${item.filename ?? "image"}`;
        const { error: upErr } = await db.storage
          .from(LIBRARY_BUCKET)
          .upload(path, new Blob([blobBytes.slice()], { type: item.contentType || "application/octet-stream" }), {
            contentType: item.contentType || undefined,
          });
        if (upErr) throw upErr;
        row.storage_path = path;
        row.filename = item.filename ?? null;
      } else if (item.url) {
        row.url = item.url;
        row.filename = item.filename ?? null;
      } else {
        continue; // image whose blob is gone and has no fallback URL
      }
    } else if (item.type === "text") {
      row.og_title = item.ogTitle ?? null;
      row.og_description = item.ogDescription ?? null;
    } else if (item.type === "music" || item.type === "link") {
      row.url = item.url ?? null;
      row.og_title = item.ogTitle ?? null;
      row.og_description = item.ogDescription ?? null;
      row.og_image = item.ogImage ?? null;
    }

    libraryRows.push(row);
  }
  if (libraryRows.length) {
    const { error } = await db.from("library_items").insert(libraryRows);
    if (error) throw error;
  }

  // Reopen the first chapter when this book is next opened.
  const firstChapter = orderedChapters[0];
  if (firstChapter) {
    await db
      .from("books")
      .update({ active_chapter_id: chapterIdMap.get(firstChapter.id) })
      .eq("id", newBookId);
  }

  return newBookId;
}
