import type { Scene, Section } from "./types";

// Whitespace-token count of a scene body. (Bodies are contentEditable HTML, so
// this is the same crude tokenizer the app has always used.) Shared so the
// Book-Info total, the store's book word count, and the library panel's
// per-chapter stat all count words the same way.
export function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Per-chapter word-count cache keyed on the chapter's `scenes` array reference.
// Editing a scene yields a new scenes array for only that chapter (mapChapter
// keeps the others referentially stable), so a keystroke recomputes one
// chapter instead of re-splitting every scene of every chapter each render.
const chapterWordCounts = new WeakMap<Scene[], number>();

export function chapterWordCount(scenes: Scene[]): number {
  const cached = chapterWordCounts.get(scenes);
  if (cached !== undefined) return cached;
  const total = scenes.reduce((st, sc) => st + countWords(sc.body), 0);
  chapterWordCounts.set(scenes, total);
  return total;
}

export function wordCountAll(sections: Section[]): number {
  return sections.reduce(
    (total, s) => total + s.chapters.reduce((ct, ch) => ct + chapterWordCount(ch.scenes), 0),
    0
  );
}
