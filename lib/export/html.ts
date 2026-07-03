/**
 * Convert a scene's stored body HTML into a flat list of paragraphs, each a
 * list of formatted text runs. Scene bodies come from a contentEditable div,
 * so the markup is loose: the first line is often bare text, later lines are
 * wrapped in <div>, line breaks are <br>, and the only inline formatting the
 * editor emits is <em> (see types.ts). We stay liberal in what we accept —
 * <p>/<div>/<br> all delimit paragraphs, <em>/<i> italicize, <strong>/<b>
 * embolden — and drop everything else to text.
 */

import { parse, type HTMLElement, type Node } from "node-html-parser";

export interface Run {
  text: string;
  italic?: boolean;
  bold?: boolean;
}

export interface HtmlParagraph {
  runs: Run[];
}

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);

// node-html-parser node types: 1 = element, 3 = text.
const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function htmlToParagraphs(html: string): HtmlParagraph[] {
  if (!html || !html.trim()) return [];

  const root = parse(html);
  const paragraphs: HtmlParagraph[] = [];
  let current: Run[] = [];

  const flush = () => {
    // Collapse whitespace-only runs; keep a paragraph only if it has real text.
    const cleaned = current
      .map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") }))
      .filter((r) => r.text.length > 0);
    if (cleaned.some((r) => r.text.trim().length > 0)) {
      paragraphs.push({ runs: cleaned });
    }
    current = [];
  };

  const walk = (node: Node, italic: boolean, bold: boolean) => {
    if (node.nodeType === NODE_TEXT) {
      const text = decodeEntities((node as unknown as { rawText: string }).rawText ?? "");
      if (text) current.push({ text, italic: italic || undefined, bold: bold || undefined });
      return;
    }
    if (node.nodeType !== NODE_ELEMENT) return;

    const el = node as HTMLElement;
    const tag = el.tagName?.toUpperCase() ?? "";

    if (tag === "BR") {
      flush();
      return;
    }

    const nextItalic = italic || tag === "EM" || tag === "I";
    const nextBold = bold || tag === "STRONG" || tag === "B";
    const isBlock = BLOCK_TAGS.has(tag);

    // A block element that opens after we've accumulated content starts fresh.
    if (isBlock) flush();
    for (const child of el.childNodes) walk(child, nextItalic, nextBold);
    if (isBlock) flush();
  };

  for (const child of root.childNodes) walk(child, false, false);
  flush();

  return paragraphs;
}
