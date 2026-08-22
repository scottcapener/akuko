"use client";

import { useEffect } from "react";
import { Button } from "./ui/Button";

interface EditorLockedOverlayProps {
  bookTitle: string;
  onEditHere: () => void;
}

// Shown on a tab that isn't the current editor for this book. It covers the whole
// editor so no typing, drag, or paste can reach a stale copy — the source of the
// two-tab save conflicts. "Edit here" hands ownership to this tab (the other tab
// goes read-only in turn).
export function EditorLockedOverlay({ bookTitle, onEditHere }: EditorLockedOverlayProps) {
  // If this tab was actively typing when another tab took over, the scene's
  // contentEditable keeps keyboard focus behind the scrim (which only blocks the
  // pointer). Blur it so no keystroke reaches a stale copy.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div className="w-full max-w-sm rounded-2xl bg-panel p-6 text-center shadow-2xl">
        <h2 className="text-lg font-semibold text-text">
          {bookTitle ? `${bookTitle} is already open` : "This book is already open"}
        </h2>
        <p className="mt-2 text-sm text-subtle">
          This tab is read-only for now. Keep writing in another tab, or edit here instead.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={onEditHere}>
            Edit here
          </Button>
        </div>
      </div>
    </div>
  );
}
