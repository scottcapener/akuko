"use client";

// Character-offset anchoring for read-view comments (SHARED_WITH_YOU.md §3.4).
// A comment stores [quote_start, quote_end) offsets into a scene's plain-text
// projection plus the quoted string. The same deterministic DOM walk maps
// selection → offsets at create time and offsets → DOM Range at paint time.
// "Update shared copy" rewrites a scene's text under its comments, so at paint
// time the offsets are only a hint and the quote is the truth (locateQuotes).
//
// The plain-text basis matches the server's body_text projection (lib/shared/
// snapshot.ts htmlToText): block boundaries (</p>, </div>) and <br> become a
// single "\n"; everything else is the text content, in document order.

interface Seg {
  node: Text;
  start: number; // offset of this text node's first char in the basis
  len: number;
}

export interface TextMap {
  root: HTMLElement;
  segs: Seg[];
  text: string;
}

function isBlock(el: Element): boolean {
  return el.tagName === "P" || el.tagName === "DIV";
}

/** Build the offset map for one rendered scene element. */
export function buildTextMap(root: HTMLElement): TextMap {
  const segs: Seg[] = [];
  let offset = 0;
  let text = "";

  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text;
        const len = t.data.length;
        if (len > 0) {
          segs.push({ node: t, start: offset, len });
          text += t.data;
          offset += len;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.tagName === "BR") {
          text += "\n";
          offset += 1;
        } else {
          const block = isBlock(el);
          walk(el);
          if (block) {
            text += "\n";
            offset += 1;
          }
        }
      }
    }
  };

  walk(root);
  return { root, segs, text };
}

/** Basis offset for a DOM point, or null if it isn't inside a mapped text node. */
function offsetFromPoint(map: TextMap, node: Node, nodeOffset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = map.segs.find((s) => s.node === node);
    if (seg) return seg.start + Math.min(nodeOffset, seg.len);
  }
  // Selection anchored on an element (e.g. between blocks): approximate by the
  // nearest following text node's start.
  return null;
}

/** [start, end) offsets for a browser Range confined to this scene, or null. */
export function offsetsFromRange(
  map: TextMap,
  range: Range
): { start: number; end: number; text: string } | null {
  const start = offsetFromPoint(map, range.startContainer, range.startOffset);
  const end = offsetFromPoint(map, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  return { start, end, text: map.text.slice(start, end) };
}

/** A DOM Range spanning [start, end) in the basis, for painting a highlight. */
export function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  const startSeg = map.segs.find((s) => start >= s.start && start <= s.start + s.len);
  const endSeg = map.segs.find((s) => end >= s.start && end <= s.start + s.len);
  if (!startSeg || !endSeg) return null;
  try {
    const range = document.createRange();
    range.setStart(startSeg.node, start - startSeg.start);
    range.setEnd(endSeg.node, end - endSeg.start);
    return range;
  } catch {
    return null;
  }
}

export interface StoredQuote {
  id: string;
  quote: string;
  start: number;
  end: number;
}

export type QuoteSpan = { start: number; end: number };

/** Where each stored quote of ONE scene sits in its current text, by id.
 *
 *  Stored offsets are exact until the author re-shares the chapter, which
 *  rewrites the scene text under them — text added or cut above a quote shifts
 *  it. So the quote is the truth and the offsets are a hint:
 *   - quote appears exactly once → that's it, and the gap from its stored start
 *     is how far the text shifted around it;
 *   - quote appears several times (short or common words) → the occurrence
 *     nearest its stored start moved by the shift of the closest uniquely-placed
 *     quote in the scene. Plain "nearest the stored start" picks the wrong copy
 *     whenever the shift exceeds the gap between copies;
 *   - quote no longer appears → null (unanchored).
 *  An empty quote has nothing to verify, so its offsets are taken as-is. On an
 *  un-reshared snapshot every shift is 0 and every quote lands on its offsets. */
export function locateQuotes(text: string, quotes: StoredQuote[]): Map<string, QuoteSpan | null> {
  const out = new Map<string, QuoteSpan | null>();
  const found = quotes.map((q) => {
    const at: number[] = [];
    for (let i = q.quote ? text.indexOf(q.quote) : -1; i !== -1; i = text.indexOf(q.quote, i + 1)) {
      at.push(i);
    }
    return { q, at };
  });
  const shifts = found
    .filter((f) => f.at.length === 1)
    .map((f) => ({ start: f.q.start, shift: f.at[0] - f.q.start }));

  for (const { q, at } of found) {
    if (!q.quote) { out.set(q.id, { start: q.start, end: q.end }); continue; }
    if (at.length === 0) { out.set(q.id, null); continue; }
    let shift = 0;
    let gap = Infinity;
    for (const s of shifts) {
      const d = Math.abs(s.start - q.start);
      if (d < gap) { gap = d; shift = s.shift; }
    }
    const target = q.start + shift;
    // First-wins on ties, so an exact midpoint resolves to the earlier copy.
    const best = at.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    out.set(q.id, { start: best, end: best + q.quote.length });
  }
  return out;
}

// ── Tier-2 editor highlighting (SHARED_WITH_YOU.md §3.7) ──────────────────────
// The editor's Comments tab can't index into the immutable snapshot — it points
// at the *live* scene, which the author has since been editing. So instead of
// offsets we do a plain substring search of the live text for the stored quote:
// exactly one match → a Range to highlight; zero or many → no highlight (the card
// still lists the quote). Recomputed on demand, never stored, degrades silently.

/** A Range for the sole occurrence of `needle` in `root`'s text, else null.
 *  Zero matches (the author revised the quoted text) and multiple matches (the
 *  quote is ambiguous) both return null — highlighting stays opportunistic. */
export function findUniqueTextRange(root: HTMLElement, needle: string): Range | null {
  if (!needle) return null;
  // root.textContent concatenates descendant text-node data in document order
  // with no separators — the exact basis a SHOW_TEXT walk reproduces below.
  const text = root.textContent ?? "";
  const first = text.indexOf(needle);
  if (first === -1) return null;
  if (text.indexOf(needle, first + 1) !== -1) return null; // ambiguous → skip
  const end = first + needle.length;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;
    if (startNode == null && first < offset + len) {
      startNode = node;
      startOffset = first - offset;
    }
    if (startNode != null && end <= offset + len) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += len;
  }
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}
