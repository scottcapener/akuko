import { Fragment } from "react";
import Link from "next/link";

/**
 * Minimal, server-side Markdown renderer for our legal documents.
 *
 * It deliberately supports only the subset of Markdown used in
 * `content/legal/*.md` — headings, bold, links, unordered lists, pipe tables,
 * horizontal rules, and paragraphs — and styles each with the Hot Cocoa design
 * tokens. The `.md` files stay the source of truth; edit those and these pages
 * follow. No client JS and no third-party parser.
 */

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Inline formatting: **bold** and [label](href). Everything else is plain text.
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${k}`} className="font-semibold text-text">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      const label = match[4];
      const href = match[5];
      const linkClass =
        "text-accent hover:text-accent-hi underline underline-offset-2 transition-colors";

      if (href.startsWith("/")) {
        nodes.push(
          <Link key={`${keyPrefix}-l-${k}`} href={href} className={linkClass}>
            {label}
          </Link>,
        );
      } else {
        const external = href.startsWith("http");
        nodes.push(
          <a
            key={`${keyPrefix}-l-${k}`}
            href={href}
            className={linkClass}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {label}
          </a>,
        );
      }
    }

    lastIndex = regex.lastIndex;
    k++;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function isBlockStart(line: string): boolean {
  const t = line.trim();
  return (
    line.startsWith("#") ||
    line.startsWith("- ") ||
    line.startsWith("|") ||
    t === "---"
  );
}

function cells(row: string): string[] {
  // "| a | b |" -> ["a", "b"]
  return row
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

export default function LegalDocument({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (line.trim() === "---") {
      blocks.push(<hr key={key++} className="border-border-subtle my-10" />);
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      const text = line.slice(4);
      blocks.push(
        <h3 key={key++} className="text-[15px] font-semibold text-text mt-7 mb-2">
          {renderInline(text, `h3-${key}`)}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      blocks.push(
        <h2
          key={key++}
          id={slug(text)}
          className="text-lg font-semibold text-text mt-12 mb-3 scroll-mt-8"
        >
          {renderInline(text, `h2-${key}`)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      const text = line.slice(2);
      blocks.push(
        <h1 key={key++} className="text-heading-xl tracking-tight text-text mb-3">
          {renderInline(text, `h1-${key}`)}
        </h1>,
      );
      i++;
      continue;
    }

    // Pipe table
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i]);
        i++;
      }
      const header = cells(rows[0]);
      const body = rows.slice(2).map((r) => cells(r)); // row[1] is the |---| separator
      blocks.push(
        <div key={key++} className="my-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="text-left text-[11px] font-medium uppercase tracking-wide text-subtle px-3 py-2 border-b border-border-subtle"
                  >
                    {renderInline(h, `th-${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td
                      key={ci}
                      className="align-top px-3 py-2.5 leading-6 text-text/70 border-b border-border-subtle"
                    >
                      {renderInline(c, `td-${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="list-disc pl-5 space-y-2 mb-4 marker:text-subtle"
        >
          {items.map((it, ii) => (
            <li key={ii} className="text-sm leading-7 text-text/70 pl-1">
              {renderInline(it, `li-${key}-${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph: gather consecutive lines until a blank line or a new block.
    // Single line breaks within the paragraph are preserved (e.g. the
    // Effective/Last-updated header pair).
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="text-sm leading-7 text-text/70 mb-4">
        {para.map((l, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(l, `p-${key}-${li}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <>{blocks}</>;
}
