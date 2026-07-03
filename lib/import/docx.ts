"use client";

/**
 * Client-side .docx import. Parses a Word document into prose and rebuilds it
 * as a BRAND-NEW book (new ids for every row) — it never touches an existing
 * book, mirroring restore.ts.
 *
 * Chapter detection uses a text heuristic: a short block whose text opens with
 * "Chapter"/"Prologue"/"Epilogue" starts a new chapter, and its text becomes
 * the chapter title. A document with no such markers imports as a single
 * chapter. Only the app's supported inline formatting survives (plain text +
 * italics); bold and everything else flattens to text, and images/tables are
 * dropped — scene bodies can't hold them anyway (see types.ts).
 */

import { parse, type HTMLElement } from "node-html-parser";
import { createClient } from "../supabase/client";
import { htmlToParagraphs, type HtmlParagraph } from "../export/html";

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);
const CHAPTER_RE = /^\s*(chapter|prologue|epilogue)\b/i;

interface ParsedChapter {
  title: string;
  paragraphs: HtmlParagraph[];
}

/** A block is a chapter heading if it's short and opens with a chapter word. */
function isChapterHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  return CHAPTER_RE.test(t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Serialize parsed paragraphs into the editor's body HTML (text + <em>). */
function paragraphsToBody(paragraphs: HtmlParagraph[]): string {
  return paragraphs
    .map((p) => {
      const inner = p.runs
        .map((r) => {
          const t = escapeHtml(r.text);
          return r.italic ? `<em>${t}</em>` : t;
        })
        .join("");
      return `<div>${inner}</div>`;
    })
    .join("");
}

function wordCount(paragraphs: HtmlParagraph[]): number {
  const text = paragraphs
    .flatMap((p) => p.runs.map((r) => r.text))
    .join(" ")
    .trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Parse Word HTML into ordered chapters using the chapter-text heuristic. */
function splitIntoChapters(html: string): ParsedChapter[] {
  const root = parse(html);

  // Flatten to the ordered list of top-level block elements.
  const blocks: HTMLElement[] = [];
  for (const node of root.childNodes) {
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    if (BLOCK_TAGS.has(el.tagName?.toUpperCase() ?? "")) blocks.push(el);
  }

  const chapters: ParsedChapter[] = [];
  let current: { title: string; html: string } | null = null;

  const flush = () => {
    if (!current) return;
    const paragraphs = htmlToParagraphs(current.html);
    chapters.push({ title: current.title, paragraphs });
    current = null;
  };

  for (const block of blocks) {
    const text = block.text ?? "";
    if (isChapterHeading(text)) {
      flush();
      current = { title: text.trim(), html: "" };
    } else {
      if (!current) current = { title: "Chapter 1", html: "" };
      current.html += block.toString();
    }
  }
  flush();

  return chapters;
}

export interface ImportResult {
  bookId: string;
  title: string;
  chapterCount: number;
}

/**
 * Import a .docx File as a new book owned by `userId`. Returns the new book id.
 * The new book is made active (last_opened_at = now) so the caller can send the
 * user straight into the writer.
 */
export async function importDocx(userId: string, file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();

  // Dynamic import keeps mammoth out of the initial bundle; the bundler's
  // "browser" field remap makes it browser-safe.
  const mammoth = (await import("mammoth")).default;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  let chapters = splitIntoChapters(html);
  // Drop leading/trailing chapters that came out empty (e.g. blank title page).
  chapters = chapters.filter((c) => c.paragraphs.length > 0);
  if (chapters.length === 0) {
    throw new Error("This document doesn’t contain any readable text to import.");
  }

  const title = file.name.replace(/\.docx$/i, "").trim() || "Imported Book";
  const totalWords = chapters.reduce((sum, c) => sum + wordCount(c.paragraphs), 0);

  const db = createClient();

  // ── New ids ────────────────────────────────────────────────────────
  const bookId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const chapterRows = chapters.map((c, i) => ({
    id: crypto.randomUUID(),
    title: c.title,
    position: i,
    body: paragraphsToBody(c.paragraphs),
  }));

  // ── Book ───────────────────────────────────────────────────────────
  const { error: bookErr } = await db.from("books").insert({
    id: bookId,
    user_id: userId,
    title,
    word_count: totalWords,
    active_chapter_id: chapterRows[0].id,
    last_opened_at: new Date().toISOString(),
  });
  if (bookErr) throw bookErr;

  // ── Section ────────────────────────────────────────────────────────
  const { error: sectionErr } = await db.from("sections").insert({
    id: sectionId,
    book_id: bookId,
    label: "Chapters",
    position: 0,
  });
  if (sectionErr) throw sectionErr;

  // ── Chapters ───────────────────────────────────────────────────────
  const { error: chaptersErr } = await db.from("chapters").insert(
    chapterRows.map((c) => ({
      id: c.id,
      book_id: bookId,
      section_id: sectionId,
      title: c.title,
      position: c.position,
    }))
  );
  if (chaptersErr) throw chaptersErr;

  // ── Scenes (one per chapter) ───────────────────────────────────────
  const { error: scenesErr } = await db.from("scenes").insert(
    chapterRows.map((c) => ({
      chapter_id: c.id,
      label: "",
      body: c.body,
      position: 0,
    }))
  );
  if (scenesErr) throw scenesErr;

  return { bookId, title, chapterCount: chapterRows.length };
}
