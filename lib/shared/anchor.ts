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
