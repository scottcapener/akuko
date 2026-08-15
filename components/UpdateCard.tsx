"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { freshlyStirred, type Update, type UpdateBlock } from "@/lib/updates";

// ── Update card ───────────────────────────────────────────────────────────────
// The presentation for a single What's New entry, shared by the writer's modal
// and the Updates feed. It draws only the content — the date line, an optional
// "NEW" badge + title, the featured image, and the body. Chrome that belongs to
// the container (the modal's close button) is passed in via `action`, so this
// component stays identical in both places.
//
// The body's inline emphasis comes from lib/updates, which is repo-authored and
// trusted; that's the only reason `dangerouslySetInnerHTML` is used here.

function NewBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
      New
    </span>
  );
}

function Block({ block }: { block: UpdateBlock }) {
  switch (block.kind) {
    case "lead":
      return <p className="text-sm italic text-text">{block.text}</p>;
    case "paragraph":
      return (
        <p
          className="text-sm leading-relaxed text-text"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    case "bullets":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-text marker:text-subtle">
          {block.items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
          ))}
        </ul>
      );
  }
}

export default function UpdateCard({
  update,
  showNew = false,
  action,
}: {
  update: Update;
  /** Draw the "NEW" badge beside the title (modal only — never in the feed). */
  showNew?: boolean;
  /** Rendered at the top-right of the date row — the modal's close button. */
  action?: ReactNode;
}) {
  // The featured image keeps its natural proportions at any width; a missing or
  // broken source falls back to the proportional accent block from the design.
  const [imageOk, setImageOk] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);
  // React's onError can miss a source that fails before hydration (the markup is
  // server-rendered), so reconcile against the real element on mount: if it has
  // already failed, flip now; if it's still in flight, attach a native listener.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      if (img.naturalWidth === 0) setImageOk(false);
      return;
    }
    const onError = () => setImageOk(false);
    img.addEventListener("error", onError);
    return () => img.removeEventListener("error", onError);
  }, []);
  const showImage = Boolean(update.image) && imageOk;

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs text-subtle">{freshlyStirred(update.date)}</span>
          {action}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {showNew && <NewBadge />}
          <h2 className="text-lg font-semibold text-text">{update.title}</h2>
        </div>
      </div>

      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={update.image}
          alt={update.imageAlt ?? ""}
          className="mt-4 block w-full"
          onError={() => setImageOk(false)}
        />
      ) : (
        <div className="mt-4 aspect-[16/9] w-full bg-accent" />
      )}

      <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
        {update.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
