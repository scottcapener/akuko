"use client";

// Find/Replace across the manuscript (chapter titles + scene prose — the text
// that reaches the Read view). Search runs entirely in memory: the store's
// background prefetch loads every chapter's scenes into `sections`, so we never
// need a chapter mounted to search or even to replace it. Highlighting and
// caret-centring, which do need the DOM, live in components/FindReplaceBar.
//
// Prose offsets share the comment anchoring basis (lib/shared/anchor buildTextMap):
// text-node data in document order, with a synthetic "\n" at each block/<br>
// boundary. A typed needle never contains "\n", so a match never straddles a
// block — which is exactly what keeps two adjacent paragraphs from producing a
// phantom match across their seam.

import { Section } from "@/lib/types";
import { buildTextMap, rangeFromOffsets, type TextMap } from "@/lib/shared/anchor";

export interface FindMatch {
  sectionId: string;
  chapterId: string;
  // null → the match is in the chapter title (a plain <input>, so it can't take a
  // ::highlight() tint — the bar selects it natively instead). Otherwise the id of
  // the scene whose body holds the match.
  sceneId: string | null;
  start: number; // inclusive offset into the title string / scene text basis
  end: number; // exclusive
}

/** Case-insensitive, non-overlapping match offsets of `needle` in `haystack`. */
export function findRanges(haystack: string, needle: string): [number, number][] {
  const out: [number, number][] = [];
  if (!needle) return out;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  // toLowerCase preserves length for the scripts this editor handles, so offsets
  // into the lowercased string map 1:1 back onto the original.
  let i = h.indexOf(n);
  while (i !== -1) {
    out.push([i, i + needle.length]);
    i = h.indexOf(n, i + needle.length);
  }
  return out;
}

/** Build the text-node offset map for a body HTML string, off-DOM. */
function bodyTextMap(body: string): TextMap {
  const div = document.createElement("div");
  div.innerHTML = body ?? "";
  return buildTextMap(div);
}

export { rangeFromOffsets };

/** Text basis for a scene body — same projection the highlight ranges paint on. */
export function bodyText(body: string): string {
  return bodyTextMap(body).text;
}

/**
 * Every match of `needle` across the chapters in `chapterIds`, in book order:
 * sections as given, chapters within, then per chapter the title match(es)
 * followed by each scene's matches in reading order.
 */
export function searchScope(
  sections: Section[],
  chapterIds: Set<string>,
  needle: string
): FindMatch[] {
  const res: FindMatch[] = [];
  if (!needle) return res;
  for (const section of sections) {
    for (const chapter of section.chapters) {
      if (!chapterIds.has(chapter.id)) continue;
      for (const [start, end] of findRanges(chapter.title ?? "", needle)) {
        res.push({ sectionId: section.id, chapterId: chapter.id, sceneId: null, start, end });
      }
      for (const scene of chapter.scenes) {
        const text = bodyText(scene.body ?? "");
        for (const [start, end] of findRanges(text, needle)) {
          res.push({ sectionId: section.id, chapterId: chapter.id, sceneId: scene.id, start, end });
        }
      }
    }
  }
  return res;
}

// ── Replacement into prose HTML ───────────────────────────────────────────────
// Splice a [start,end) range of the basis with `replacement`, editing the live
// text nodes so inline formatting around the match survives. A match confined to
// one text node is the common case (replace-all of a word); one that spans an
// inline tag (e.g. the second half italicised) edits across nodes, the
// replacement inheriting the first node's formatting. A range that would cross a
// synthetic block boundary is skipped — it can only arise from a needle that
// itself spans blocks, which the plain-text search can't produce.

function spliceRange(map: TextMap, start: number, end: number, replacement: string): boolean {
  const segs = map.segs;
  const si = segs.findIndex((s) => start >= s.start && start <= s.start + s.len);
  const ei = segs.findIndex((s) => end >= s.start && end <= s.start + s.len);
  if (si === -1 || ei === -1 || ei < si) return false;
  // No synthetic gap may sit inside the range, or the match crossed a block/<br>.
  for (let k = si; k < ei; k++) {
    if (segs[k].start + segs[k].len !== segs[k + 1].start) return false;
  }
  if (si === ei) {
    const s = segs[si];
    const a = start - s.start;
    const b = end - s.start;
    s.node.data = s.node.data.slice(0, a) + replacement + s.node.data.slice(b);
  } else {
    const first = segs[si];
    const last = segs[ei];
    first.node.data = first.node.data.slice(0, start - first.start) + replacement;
    for (let k = si + 1; k < ei; k++) segs[k].node.data = "";
    last.node.data = last.node.data.slice(end - last.start);
  }
  return true;
}

/**
 * Apply `ranges` (basis offsets) → `replacement` to `root`'s text nodes in place,
 * returning how many landed. Processed right-to-left so a still-pending earlier
 * range keeps valid offsets against the nodes an already-applied later range
 * mutated. Caller reads `root.innerHTML` afterwards to persist / re-render.
 */
export function replaceRanges(root: HTMLElement, ranges: [number, number][], replacement: string): number {
  const map = buildTextMap(root);
  const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
  let count = 0;
  for (const [start, end] of sorted) {
    if (spliceRange(map, start, end, replacement)) count++;
  }
  return count;
}
