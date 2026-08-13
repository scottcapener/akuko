"use client";

// Character-offset anchoring for read-view comments (SHARED_WITH_YOU.md §3.4).
// A comment stores [quote_start, quote_end) offsets into a scene's plain-text
// projection plus the quoted string. Because the snapshot HTML is immutable,
// the same deterministic DOM walk maps selection → offsets at create time and
// offsets → DOM Range at paint time — so anchors never drift within a render.
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
