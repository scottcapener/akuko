"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ShareModal } from "./ShareModal";
import type { ShareState } from "@/lib/shared/types";

// The sharing mini-menu (SHARED_WITH_YOU.md §3.6): a ••• at the bottom-right of
// the Write editor's right column, the single management surface for a
// chapter's sharing. Unshared → "Share this chapter…". Shared → manage
// recipients, "Update shared copy", "Stop sharing". Opens the Share modal for
// recipient management; holds the snapshot actions itself.

const EMPTY: ShareState = { chapterId: "", sharedChapterId: null, shared: false, recipients: [] };

export function SharingMenu({ chapterId }: { chapterId: string }) {
  const [state, setState] = useState<ShareState>({ ...EMPTY, chapterId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`);
      if (!res.ok) return;
      setState(await res.json());
    } catch {
      // Leave prior state; the menu just shows "not shared".
    }
  }, [chapterId]);

  // Refresh whenever the open chapter changes.
  useEffect(() => {
    setState({ ...EMPTY, chapterId });
    setMenuOpen(false);
    setConfirmStop(false);
    load();
  }, [chapterId, load]);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openMenu() {
    setConfirmStop(false);
    setMenuOpen((v) => !v);
    load(); // refresh counts on open
  }

  function openModal() {
    setMenuOpen(false);
    setModalOpen(true);
  }

  async function updateCopy() {
    setBusy(true);
    try {
      const res = await fetch("/api/share/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      if (res.ok) setState(await res.json());
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  async function stopSharing() {
    setBusy(true);
    try {
      const res = await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`, {
        method: "DELETE",
      });
      if (res.ok) setState(await res.json());
    } finally {
      setBusy(false);
      setMenuOpen(false);
      setConfirmStop(false);
    }
  }

  const count = state.recipients.length;

  return (
    <div ref={rootRef} className="relative">
      {menuOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-60 bg-panel border border-hover rounded-xl shadow-lg overflow-hidden">
          {!state.shared ? (
            <button
              onClick={openModal}
              className="block w-full text-left px-4 py-3 text-sm text-text hover:bg-hover transition-colors"
            >
              Share this chapter…
            </button>
          ) : (
            <div className="py-1.5">
              {/* Recipients summary → manage */}
              <button
                onClick={openModal}
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-hover transition-colors text-left"
              >
                <div className="flex -space-x-2 flex-shrink-0">
                  {state.recipients.slice(0, 3).map((r) => (
                    <Avatar
                      key={r.email}
                      name={r.name}
                      src={r.avatarUrl}
                      size={22}
                      className="ring-2 ring-panel"
                    />
                  ))}
                </div>
                <span className="text-text text-sm flex-1 truncate">
                  Shared with {count} {count === 1 ? "person" : "people"}
                </span>
                <svg className="w-4 h-4 text-subtle flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.983 1.907a1.5 1.5 0 00-1.966 0l-.66.57a1.5 1.5 0 01-1.13.363l-.87-.09a1.5 1.5 0 00-1.588 1.153l-.19.855a1.5 1.5 0 01-.7.964l-.752.44a1.5 1.5 0 00-.607 1.87l.34.807a1.5 1.5 0 010 1.166l-.34.807a1.5 1.5 0 00.607 1.87l.752.44a1.5 1.5 0 01.7.964l.19.855a1.5 1.5 0 001.588 1.153l.87-.09a1.5 1.5 0 011.13.363l.66.57a1.5 1.5 0 001.966 0l.66-.57a1.5 1.5 0 011.13-.363l.87.09a1.5 1.5 0 001.588-1.153l.19-.855a1.5 1.5 0 01.7-.964l.752-.44a1.5 1.5 0 00.607-1.87l-.34-.807a1.5 1.5 0 010-1.166l.34-.807a1.5 1.5 0 00-.607-1.87l-.752-.44a1.5 1.5 0 01-.7-.964l-.19-.855a1.5 1.5 0 00-1.588-1.153l-.87.09a1.5 1.5 0 01-1.13-.363l-.66-.57zM12 15a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
              </button>

              <div className="h-px bg-border-subtle my-1.5 mx-3" />

              <button
                onClick={updateCopy}
                disabled={busy}
                className="block w-full text-left px-4 py-2.5 text-sm text-text hover:bg-hover transition-colors disabled:opacity-50"
              >
                Update shared copy
              </button>

              {confirmStop ? (
                <button
                  onClick={stopSharing}
                  disabled={busy}
                  className="block w-full text-left px-4 py-2.5 text-sm text-error font-medium hover:bg-hover transition-colors disabled:opacity-50"
                >
                  Confirm — stop sharing
                </button>
              ) : (
                <button
                  onClick={() => setConfirmStop(true)}
                  className="block w-full text-left px-4 py-2.5 text-sm text-error hover:bg-hover transition-colors"
                >
                  Stop sharing
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button
        onClick={openMenu}
        aria-label={state.shared ? `Sharing — shared with ${count}` : "Share this chapter"}
        title={state.shared ? `Shared with ${count}` : "Share this chapter"}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-subtle hover:text-text hover:bg-hover transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
        {state.shared && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
        )}
      </button>

      {modalOpen && (
        <ShareModal
          chapterId={chapterId}
          initialState={state}
          onClose={() => setModalOpen(false)}
          onStateChange={setState}
        />
      )}
    </div>
  );
}
