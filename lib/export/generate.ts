/**
 * Server-side manuscript export. Assembles a .docx from a book's chapters
 * and scenes and uploads it to the private `book-exports` bucket.
 *
 * The export is a clean reading manuscript, not a backup: it contains a
 * title page and the prose only. Scene *descriptions* (the scene `label`)
 * and the Library (images/notes/music) are intentionally excluded — the
 * point is a document you can hand to KDP or an editor.
 *
 * A caller may pass a subset of chapter ids to produce a "partial"
 * (sample chapters). Retention: at most MAX_EXPORTS_PER_USER rows per
 * user; the oldest beyond the cap are evicted (row + object).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { htmlToParagraphs } from "./html";

const EXPORT_BUCKET = "book-exports";
const MAX_EXPORTS_PER_USER = 10;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SCENE_BREAK = "* * *";

export interface GenerateExportResult {
  id: string;
  storagePath: string;
  sizeBytes: number;
  bookTitle: string;
  kind: "full" | "partial";
  chapterCount: number;
}

interface OrderedChapter {
  id: string;
  title: string;
}

/**
 * Build a .docx manuscript for `bookId` and record an `exports` row.
 *
 * `chapterIds` selects which chapters to include, in the book's own order.
 * Passing undefined, an empty list, or the full set produces a "full"
 * export; a proper subset produces a "partial".
 *
 * The caller supplies a Supabase client already scoped to the owner.
 */
export async function generateExport(
  supabase: SupabaseClient,
  userId: string,
  bookId: string,
  chapterIds?: string[]
): Promise<GenerateExportResult> {
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

  // Reading order: sections by position, chapters by position within each.
  const orderedAll: OrderedChapter[] = [];
  for (const s of sections ?? []) {
    for (const c of chapters ?? []) {
      if (c.section_id === s.id) orderedAll.push({ id: c.id, title: c.title ?? "" });
    }
  }
  // Any chapter not matched to a section (shouldn't happen) still gets included.
  for (const c of chapters ?? []) {
    if (!orderedAll.some((o) => o.id === c.id)) orderedAll.push({ id: c.id, title: c.title ?? "" });
  }

  // Apply the chapter selection (a proper subset ⇒ partial).
  const selected = new Set(chapterIds ?? []);
  const isSubset = selected.size > 0 && selected.size < orderedAll.length;
  const included = isSubset ? orderedAll.filter((c) => selected.has(c.id)) : orderedAll;
  if (included.length === 0) throw new Error("No chapters to export");
  const kind: "full" | "partial" = isSubset ? "partial" : "full";

  // ── Scenes for the included chapters ───────────────────────────────
  const includedIds = included.map((c) => c.id);
  const { data: scenes } = await supabase
    .from("scenes")
    .select("*")
    .in("chapter_id", includedIds)
    .order("position");

  const scenesByChapter = new Map<string, { body: string }[]>();
  for (const sc of scenes ?? []) {
    const list = scenesByChapter.get(sc.chapter_id) ?? [];
    list.push({ body: sc.body ?? "" });
    scenesByChapter.set(sc.chapter_id, list);
  }

  // ── Build the document ─────────────────────────────────────────────
  const bookTitle = book.title ?? "Untitled";
  const children: Paragraph[] = [];

  // Title page — vertical breathing room, centered title, optional subtitle.
  children.push(new Paragraph({ text: "", spacing: { before: 2400 } }));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: bookTitle, bold: true, size: 56 })],
    })
  );
  if (kind === "partial") {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240 },
        children: [new TextRun({ text: "Sample chapters", italics: true, size: 28 })],
      })
    );
  }

  // Chapters — each starts on a new page.
  for (const chapter of included) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: true,
        spacing: { before: 480, after: 480 },
        children: [new TextRun({ text: chapter.title || "Untitled Chapter" })],
      })
    );

    const chapterScenes = scenesByChapter.get(chapter.id) ?? [];
    let renderedAScene = false;
    for (const scene of chapterScenes) {
      const paragraphs = htmlToParagraphs(scene.body);
      if (paragraphs.length === 0) continue;

      // Scene break between consecutive non-empty scenes.
      if (renderedAScene) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [new TextRun({ text: SCENE_BREAK })],
          })
        );
      }
      renderedAScene = true;

      for (const para of paragraphs) {
        children.push(
          new Paragraph({
            indent: { firstLine: 480 },
            children: para.runs.map(
              (r) => new TextRun({ text: r.text, italics: r.italic, bold: r.bold })
            ),
          })
        );
      }
    }
  }

  const doc = new Document({
    creator: "Hot Cocoa",
    title: bookTitle,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const bytes = new Uint8Array(buffer);

  // ── Upload + record ────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `${userId}/${bookId}/${timestamp}.docx`;

  const { error: uploadErr } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(storagePath, bytes, { contentType: DOCX_MIME, upsert: false });
  if (uploadErr) throw uploadErr;

  const { data: row, error: insertErr } = await supabase
    .from("exports")
    .insert({
      user_id: userId,
      book_id: bookId,
      book_title: bookTitle,
      storage_path: storagePath,
      size_bytes: bytes.length,
      kind,
      chapter_count: included.length,
    })
    .select()
    .single();
  if (insertErr) {
    // Roll back the orphaned object so we don't leak storage.
    await supabase.storage.from(EXPORT_BUCKET).remove([storagePath]);
    throw insertErr;
  }

  await enforceRetention(supabase, userId);

  return {
    id: row.id,
    storagePath,
    sizeBytes: bytes.length,
    bookTitle,
    kind,
    chapterCount: included.length,
  };
}

/** Delete this user's oldest exports (row + Storage object) beyond the cap. */
async function enforceRetention(supabase: SupabaseClient, userId: string) {
  const { data: all } = await supabase
    .from("exports")
    .select("id, storage_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const excess = (all ?? []).slice(MAX_EXPORTS_PER_USER);
  if (excess.length === 0) return;

  await supabase.storage.from(EXPORT_BUCKET).remove(excess.map((e) => e.storage_path));
  await supabase
    .from("exports")
    .delete()
    .in("id", excess.map((e) => e.id));
}
