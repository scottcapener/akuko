"use client";

import { useEffect } from "react";

interface ConflictCopyToastProps {
  label: string;
  onDismiss: () => void;
}

// Non-blocking confirmation shown after a conflict is resolved: the version the
// author didn't keep was saved as a copy scene, so the choice is recoverable.
// Auto-dismisses; the copy scene remains in the chapter either way.
export function ConflictCopyToast({ label, onDismiss }: ConflictCopyToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [onDismiss, label]);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4">
      <div className="flex items-center gap-3 rounded-xl bg-panel px-4 py-3 shadow-2xl border border-border-subtle">
        <p className="text-sm text-text">
          The other version was saved as <span className="text-subtle">“{label}”</span>.
        </p>
        <button
          onClick={onDismiss}
          className="text-xs font-medium text-subtle hover:text-text transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
