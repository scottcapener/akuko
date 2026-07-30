"use client";

import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import type { SceneConflict } from "@/lib/useHotCocoaDb";

// Plain-text preview of a scene body (contentEditable HTML) for the side-by-side
// comparison — enough to tell the two versions apart without rendering markup.
function preview(html: string): string {
  if (typeof document === "undefined") return html;
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").trim();
}

interface ConflictModalProps {
  conflicts: SceneConflict[];
  onResolve: (sceneId: string, choice: "mine" | "theirs") => void;
}

// Surfaces offline edit conflicts one at a time: a scene was changed on another
// device after this device's queued edit was made. The author picks which
// version wins rather than one silently overwriting the other.
export function ConflictModal({ conflicts, onResolve }: ConflictModalProps) {
  const conflict = conflicts[0];
  if (!conflict) return null;

  const remaining = conflicts.length - 1;

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
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.mine.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </section>
          <section className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">Other device</h3>
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-text">
              {preview(conflict.theirs.body) || <span className="text-subtle">(empty)</span>}
            </p>
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-subtle">
            {remaining > 0 ? `${remaining} more conflict${remaining === 1 ? "" : "s"} after this` : " "}
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
