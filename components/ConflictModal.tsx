"use client";

import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
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
// device after this device's queued edit was made. The author picks which
// version wins rather than one silently overwriting the other. Each side shows
// its word count and a timestamp so a stale copy (usually fewer words, derived
// from an earlier sync point) is easy to spot before choosing.
export function ConflictModal({ conflicts, onResolve }: ConflictModalProps) {
  const conflict = conflicts[0];
  if (!conflict) return null;

  const remaining = conflicts.length - 1;
  const mineWords = countWords(conflict.mine.body);
  const theirsWords = countWords(conflict.theirs.body);
  const mineWhen = when(conflict.mine.basedOn);
  const theirsWhen = when(conflict.theirs.updatedAt);

  return (
    // No onClose dismissal — a conflict must be resolved, not clicked away.
    <Modal onClose={() => {}} maxWidth="max-w-2xl">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-text">This scene changed on another device</h2>
        <p className="mt-1 text-sm text-subtle">
          {conflict.chapterTitle ? (
            <>
              An edit you made offline in <span className="text-text">{conflict.chapterTitle}</span> couldn&apos;t
              sync because the scene was also changed elsewhere. Choose which version to keep.
            </>
          ) : (
            <>An edit you made offline couldn&apos;t sync because the scene was also changed elsewhere. Choose which version to keep.</>
          )}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">This device</h3>
            <p className="mt-1 text-xs text-subtle">
              <span className="text-text">{mineWords.toLocaleString()} {mineWords === 1 ? "word" : "words"}</span>
              {mineWhen && <> · based on {mineWhen}</>}
            </p>
            <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.mine.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </section>
          <section className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">Other device</h3>
            <p className="mt-1 text-xs text-subtle">
              <span className="text-text">{theirsWords.toLocaleString()} {theirsWords === 1 ? "word" : "words"}</span>
              {theirsWhen && <> · saved {theirsWhen}</>}
            </p>
            <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.theirs.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-subtle">
            {remaining > 0 ? `${remaining} more conflict${remaining === 1 ? "" : "s"} after this` : " "}
          </span>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => onResolve(conflict.sceneId, "theirs")}>
              Keep other device
            </Button>
            <Button variant="secondary" onClick={() => onResolve(conflict.sceneId, "mine")}>
              Keep this device
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
