"use client";

import { Modal } from "./ui/Modal";
import { countWords } from "@/lib/words";
import type { SceneConflict } from "@/lib/useHotCocoaDb";

// Plain-text preview of a scene body (contentEditable HTML) for the side-by-side
// comparison — enough to tell the two versions apart without rendering markup.
function preview(html: string): string {
  if (typeof document === "undefined") return html;
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").trim();
}

// Compact "Aug 22, 3:47 PM" — enough to tell two versions apart at a glance.
function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ConflictModalProps {
  conflicts: SceneConflict[];
  onResolve: (sceneId: string, choice: "mine" | "theirs") => void;
}

// Surfaces offline edit conflicts one at a time: a scene was changed on another
// device after this device's queued edit was made. Each version is a clickable
// card — the author picks one by choosing it directly, rather than matching a
// separate button back to a block. Word count and a timestamp on each side make
// a stale copy (usually fewer words, from an earlier sync point) easy to spot.
export function ConflictModal({ conflicts, onResolve }: ConflictModalProps) {
  const conflict = conflicts[0];
  if (!conflict) return null;

  const remaining = conflicts.length - 1;
  const mineWords = countWords(conflict.mine.body);
  const theirsWords = countWords(conflict.theirs.body);
  const mineWhen = when(conflict.mine.basedOn);
  const theirsWhen = when(conflict.theirs.updatedAt);

  // Shared card styling — the whole block is the action, so it carries the
  // hover/focus affordances rather than a separate button.
  const cardClass =
    "rounded-xl border border-border-subtle p-4 text-left transition-colors cursor-pointer " +
    "hover:border-accent/40 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    // No onClose dismissal — a conflict must be resolved, not clicked away.
    <Modal onClose={() => {}} maxWidth="max-w-2xl">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-text">This scene changed on another device</h2>
        <p className="mt-1 text-sm text-subtle">
          {conflict.chapterTitle ? (
            <>
              An edit you made offline in <span className="text-text">{conflict.chapterTitle}</span> couldn&apos;t
              sync because the scene was also changed elsewhere. Which version would you like to keep?
            </>
          ) : (
            <>An edit you made offline couldn&apos;t sync because the scene was also changed elsewhere. Which version would you like to keep?</>
          )}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onResolve(conflict.sceneId, "mine")}
            aria-label="Keep this device&apos;s version"
            className={cardClass}
          >
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">This device</h3>
            <p className="mt-1 text-xs text-subtle">
              <span className="text-text">{mineWords.toLocaleString()} {mineWords === 1 ? "word" : "words"}</span>
              {mineWhen && <> · based on {mineWhen}</>}
            </p>
            <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.mine.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </button>
          <button
            type="button"
            onClick={() => onResolve(conflict.sceneId, "theirs")}
            aria-label="Keep the other device&apos;s version"
            className={cardClass}
          >
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">Other device</h3>
            <p className="mt-1 text-xs text-subtle">
              <span className="text-text">{theirsWords.toLocaleString()} {theirsWords === 1 ? "word" : "words"}</span>
              {theirsWhen && <> · saved {theirsWhen}</>}
            </p>
            <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.theirs.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </button>
        </div>

        {remaining > 0 && (
          <p className="mt-5 text-center text-xs text-subtle">
            {remaining} more conflict{remaining === 1 ? "" : "s"} after this
          </p>
        )}
      </div>
    </Modal>
  );
}
