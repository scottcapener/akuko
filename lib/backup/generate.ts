/**
 * Server-side backup generation. Shared by the manual backup route and
 * the automatic cadence sweep. Never import from a client component —
 * this reads Storage blobs and assembles a ZIP with fflate.
 *
 * Retention: at most MAX_BACKUPS_PER_BOOK rows per book. After each
 * successful insert, that book's oldest beyond the cap are evicted (row +
 * object). Scoping per-book (not per-user) keeps a busy auto-cadence on one
 * book from evicting another book's backups.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { zipSync, strToU8 } from "fflate";
import {
  SCHEMA_VERSION,
  MANIFEST_FILENAME,
  IMAGES_DIR,
  COVER_ENTRY,
  type BackupManifest,
  type BackupLibraryItem,
} from "./manifest";

const LIBRARY_BUCKET = "library-files";
const BACKUP_BUCKET = "book-backups";
const MAX_BACKUPS_PER_BOOK = 10;

// Per-object ceiling for a backup ZIP. The book-backups bucket is capped at
// this in 006_backup_bucket_limit.sql (the Supabase Free global limit). We
// preflight against it here so the user gets a clear message instead of the
// raw "object exceeded the maximum allowed size" from Storage.
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Thrown when a backup ZIP is larger than the Storage per-object limit. */
export class BackupTooLargeError extends Error {}

function tooLargeMessage(actualBytes?: number): string {
  const limitMb = Math.round(MAX_BACKUP_BYTES / 1024 / 1024);
  const actual = actualBytes ? `${Math.round(actualBytes / 1024 / 1024)} MB, over` : "over";
  return `This book's backup is ${actual} the ${limitMb} MB limit. Large library images are the usual cause — remove or shrink some, then try again.`;
}

export interface GenerateResult {
  id: string;
  storagePath: string;
  sizeBytes: number;
  bookTitle: string;
}

/**
 * Read a book and everything under it, download its bundled library
 * images, assemble a ZIP, upload it to `book-backups`, record a
 * `backups` row (with a snapshotted book_title), then enforce retention.
 *
 * The caller supplies a Supabase client already scoped to the owner —
 * either the user's session client (manual) or a service-role client
 * (cron). `userId` is the backup owner used for the storage path and
 * the row's user_id.
 */
export async function generateBackup(
  supabase: SupabaseClient,
  userId: string,
  bookId: string,
  trigger: "manual" | "auto"
): Promise<GenerateResult> {
  // ── Read the book graph ────────────────────────────────────────────
  const { data: book, error: bookErr } = await supabase
    .from("books")
    .select("*")
    .eq("id", bookId)
    .single();
  if (bookErr || !book) throw new Error("Book not found");

  const [{ data: sections }, { data: chapters }] = await Promise.all([
    supabase.from("sections").select("*").eq("book_id", bookId).order("position"),
    supabase.from("chapters").select("*").eq("book_id", bookId).order("position"),
  ]);

  const chapterIds = (chapters ?? []).map((c) => c.id);

  // scenes + library items are keyed by chapter, not book, so fetch by id set
  const [{ data: scenes }, { data: libraryItems }] = await Promise.all([
    chapterIds.length
      ? supabase.from("scenes").select("*").in("chapter_id", chapterIds).order("position")
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    chapterIds.length
      ? supabase.from("library_items").select("*").in("chapter_id", chapterIds).order("position")
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // ── Assemble the ZIP contents ──────────────────────────────────────
  const files: Record<string, Uint8Array> = {};
  const manifestItems: BackupLibraryItem[] = [];

  for (const item of libraryItems ?? []) {
    const base: BackupLibraryItem = {
      id: item.id,
      chapterId: item.chapter_id,
      type: item.type,
      position: item.position ?? 0,
      url: item.url ?? undefined,
      ogTitle: item.og_title ?? undefined,
      ogDescription: item.og_description ?? undefined,
      ogImage: item.og_image ?? undefined,
      filename: item.filename ?? undefined,
    };

    // Images stored in library-files: download the blob and bundle it.
    if (item.type === "image" && item.storage_path) {
      const { data: blob, error } = await supabase.storage
        .from(LIBRARY_BUCKET)
        .download(item.storage_path);
      if (!error && blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const entry = `${IMAGES_DIR}/${item.id}`;
        files[entry] = bytes;
        base.imageFile = entry;
        base.contentType = blob.type || undefined;
      }
      // If the blob is missing (e.g. already deleted), fall through and
      // record the item without a bundled file — restore skips it.
    }

    manifestItems.push(base);
  }

  // Cover: bundle the stored blob so a restore works even after the source
  // book (and its cover object) is deleted. Legacy data/http URL covers are
  // self-contained and copied as-is.
  const coverRaw = book.cover_image_path as string | null;
  let coverImagePath: string | undefined;
  let coverImageFile: string | undefined;
  let coverContentType: string | undefined;
  if (coverRaw && !coverRaw.startsWith("data:") && !/^https?:/.test(coverRaw)) {
    const { data: coverBlob, error } = await supabase.storage
      .from(LIBRARY_BUCKET)
      .download(coverRaw);
    if (!error && coverBlob) {
      files[COVER_ENTRY] = new Uint8Array(await coverBlob.arrayBuffer());
      coverImageFile = COVER_ENTRY;
      coverContentType = coverBlob.type || undefined;
    }
    // Missing blob (e.g. already deleted): fall through with no cover.
  } else if (coverRaw) {
    coverImagePath = coverRaw;
  }

  const manifest: BackupManifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    book: {
      title: book.title ?? "Untitled",
      coverColor: book.cover_color ?? "#2a2a2e",
      coverImagePath,
      coverImageFile,
      coverContentType,
      wordCount: book.word_count ?? 0,
      unlocks: Array.isArray(book.unlocks) ? book.unlocks : [],
    },
    sections: (sections ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      position: s.position ?? 0,
    })),
    chapters: (chapters ?? []).map((c) => ({
      id: c.id,
      sectionId: c.section_id,
      title: c.title,
      position: c.position ?? 0,
    })),
    scenes: (scenes ?? []).map((s) => ({
      id: s.id,
      chapterId: s.chapter_id,
      label: s.label ?? "",
      body: s.body ?? "",
      position: s.position ?? 0,
    })),
    libraryItems: manifestItems,
  };

  files[MANIFEST_FILENAME] = strToU8(JSON.stringify(manifest));

  const zipped = zipSync(files);
  // fflate returns a Uint8Array that may be a view over a larger buffer;
  // slice to an exact-length copy before handing it to fetch/Storage.
  const zipBytes = zipped.slice();

  // Preflight: fail with a clear message before attempting a doomed upload.
  if (zipBytes.length > MAX_BACKUP_BYTES) {
    throw new BackupTooLargeError(tooLargeMessage(zipBytes.length));
  }

  // ── Upload + record ────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `${userId}/${bookId}/${timestamp}.zip`;

  const { error: uploadErr } = await supabase.storage
    .from(BACKUP_BUCKET)
    .upload(storagePath, zipBytes, { contentType: "application/zip", upsert: false });
  if (uploadErr) {
    // Fallback in case Storage's configured limit is lower than our constant.
    if (/exceeded the maximum allowed size|maximum allowed size|payload too large/i.test(uploadErr.message)) {
      throw new BackupTooLargeError(tooLargeMessage());
    }
    throw uploadErr;
  }

  const { data: row, error: insertErr } = await supabase
    .from("backups")
    .insert({
      user_id: userId,
      book_id: bookId,
      book_title: book.title ?? "Untitled",
      storage_path: storagePath,
      size_bytes: zipBytes.length,
      trigger,
      status: "complete",
    })
    .select()
    .single();
  if (insertErr) {
    // Roll back the orphaned object so we don't leak storage.
    await supabase.storage.from(BACKUP_BUCKET).remove([storagePath]);
    throw insertErr;
  }

  await enforceRetention(supabase, bookId);

  return {
    id: row.id,
    storagePath,
    sizeBytes: zipBytes.length,
    bookTitle: book.title ?? "Untitled",
  };
}

/** Delete this book's oldest backups (row + Storage object) beyond the cap. */
async function enforceRetention(supabase: SupabaseClient, bookId: string) {
  const { data: all } = await supabase
    .from("backups")
    .select("id, storage_path")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false });

  const excess = (all ?? []).slice(MAX_BACKUPS_PER_BOOK);
  if (excess.length === 0) return;

  await supabase.storage.from(BACKUP_BUCKET).remove(excess.map((b) => b.storage_path));
  await supabase
    .from("backups")
    .delete()
    .in("id", excess.map((b) => b.id));
}
