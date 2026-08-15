"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ShareModal } from "./ShareModal";
import { useUnread } from "@/lib/useUnread";
import type { ShareState } from "@/lib/shared/types";

// The Chapter Menu (SHARED_WITH_YOU.md §3.6; redesigned in Stage 8 to match
// Figma 297-26768 and the Account Menu's style). The ••• at the bottom-right of
// the Write editor's right column opens it. Five states:
//   1 Not shared — Share button + Delete chapter.
//   2 Shared     — SHARED row (up to 3 partner avatars) + Update + Stop sharing.
//   3 Updating   — Update button shows a spinner.
//   4 Updated    — Update button confirms, then returns to state 2 after 1600ms.
//   5 Error      — a general error line under Update.
// The Share / manage-recipients modal is opened from here; the snapshot actions
// (Update / Stop sharing) live in the menu itself.

const EMPTY: ShareState = { chapterId: "", sharedChapterId: null, shared: false, recipients: [] };

type UpdatePhase = "idle" | "updating" | "updated" | "error";

export function SharingMenu({
  chapterId,
  chapterTitle,
  onDeleteChapter,
}: {
  chapterId: string;
  chapterTitle: string;
  onDeleteChapter: (chapterId: string) => void;
}) {
  const [state, setState] = useState<ShareState>({ ...EMPTY, chapterId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alsoStopSharing, setAlsoStopSharing] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("idle");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`);
      if (!res.ok) return;
      setState(await res.json());
    } catch {
      // Leave prior state; the menu just shows "not shared".
    }
  }, [chapterId]);

  // Refresh + fully reset transient UI whenever the open chapter changes.
  useEffect(() => {
    setState({ ...EMPTY, chapterId });
    setMenuOpen(false);
    setConfirmStop(false);
    setConfirmDelete(false);
    setUpdatePhase("idle");
    if (updateTimer.current) clearTimeout(updateTimer.current);
    load();
  }, [chapterId, load]);

  // Clear a pending "updated → idle" revert on unmount.
  useEffect(() => () => { if (updateTimer.current) clearTimeout(updateTimer.current); }, []);

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
    if (updatePhase === "error") setUpdatePhase("idle");
    setMenuOpen((v) => !v);
    load(); // refresh recipients/state on open
  }

  function openModal() {
    setMenuOpen(false);
    setModalOpen(true);
  }

  // Update shared copy — the button itself walks through updating → updated →
  // (1600ms) idle, or → error. The menu stays open so the states are visible.
  async function updateCopy() {
    if (updatePhase === "updating") return;
    setUpdatePhase("updating");
    try {
      const res = await fetch("/api/share/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      if (!res.ok) throw new Error("update failed");
      setState(await res.json());
      // Re-share can restale some comments (§7); nudge an open Comments tab.
      window.dispatchEvent(new CustomEvent("hc:shared-updated"));
      setUpdatePhase("updated");
      updateTimer.current = setTimeout(() => setUpdatePhase("idle"), 1600);
    } catch {
      setUpdatePhase("error");
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

  async function confirmDeleteChapter() {
    // Stop sharing BEFORE deleting: the snapshot is keyed by chapter_id, which the
    // delete nulls out (§7), so it must go first.
    if (state.shared && alsoStopSharing) {
      try {
        await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`, { method: "DELETE" });
      } catch {
        // Best-effort; still delete the chapter (its snapshot just lingers).
      }
    }
    onDeleteChapter(chapterId);
    setConfirmDelete(false);
  }

  const count = state.recipients.length;

  // The dot signals *new comments to look at* on this chapter — not merely that
  // the chapter is shared (§6). Same unread source as the Comments-tab badge.
  const { chapters: unreadChapters } = useUnread();
  const unreadComments =
    unreadChapters.find((c) => c.chapterId === chapterId)?.unreadComments ?? 0;

  const accentBtn =
    "w-full flex items-center justify-center gap-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium py-2 hover:bg-accent-hi transition-colors";

  return (
    <div ref={rootRef} className="relative">
      {menuOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-48 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 flex flex-col gap-1.5">
            {state.shared ? (
              <>
                {/* SHARED row — label + up to 3 partner avatars; opens manage. */}
                <button
                  onClick={openModal}
                  title="Manage recipients"
                  aria-label={`Shared with ${count} — manage recipients`}
                  className="flex items-center justify-between px-1.5 py-1 rounded-md hover:bg-hover transition-colors"
                >
                  <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">Shared</span>
                  <span className="flex -space-x-2">
                    {state.recipients.slice(0, 3).map((r) => (
                      <Avatar key={r.email} name={r.name} src={r.avatarUrl} size={20} className="ring-2 ring-panel" />
                    ))}
                  </span>
                </button>

                {/* Update — drives states 3/4/5 in place. */}
                <button
                  onClick={updateCopy}
                  disabled={updatePhase === "updating" || updatePhase === "updated"}
                  className={`${accentBtn} disabled:opacity-90`}
                >
                  {updatePhase === "updating" ? (
                    <><Spinner /> Updating</>
                  ) : updatePhase === "updated" ? (
                    <><CheckIcon /> Updated</>
                  ) : (
                    "Update"
                  )}
                </button>
                {updatePhase === "error" && (
                  <p className="text-error text-[11px] text-center leading-snug">
                    Something went wrong.<br />Please try again.
                  </p>
                )}

                {/* Stop sharing — outline; two-tap confirm since it's destructive. */}
                {confirmStop ? (
                  <button
                    onClick={stopSharing}
                    disabled={busy}
                    className="w-full rounded-lg border border-error/40 text-error text-xs font-medium py-2 hover:bg-hover transition-colors disabled:opacity-50"
                  >
                    Confirm — stop sharing
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmStop(true)}
                    className="w-full rounded-lg border border-hover text-text text-xs py-2 hover:bg-hover transition-colors"
                  >
                    Stop sharing
                  </button>
                )}
              </>
            ) : (
              /* State 1 — not shared. */
              <button onClick={openModal} className={accentBtn}>
                Share
              </button>
            )}
          </div>

          {/* Delete chapter — separated, in the Account Menu's divided style. */}
          <div className="border-t border-hover" />
          <button
            onClick={() => { setMenuOpen(false); setAlsoStopSharing(false); setConfirmDelete(true); }}
            className="block w-full text-left px-4 py-2.5 text-xs text-error hover:bg-hover transition-colors"
          >
            Delete chapter
          </button>
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
        {unreadComments > 0 && (
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

      {confirmDelete && (
        <ConfirmModal
          message={
            <>
              Delete <strong className="text-text">{chapterTitle}</strong>?{" "}
              All scenes and library items will be permanently deleted.
              {state.shared && (
                <> This chapter is shared — the copy your readers have keeps working unless you stop sharing too.</>
              )}
            </>
          }
          extra={
            state.shared ? (
              <Checkbox
                checked={alsoStopSharing}
                onChange={setAlsoStopSharing}
                label={
                  <>
                    Also stop sharing this chapter — removes recipients’ access and deletes their
                    comments.
                  </>
                }
              />
            ) : undefined
          }
          confirmLabel="Delete chapter"
          onConfirm={confirmDeleteChapter}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 3a9 9 0 019 9h-3a6 6 0 00-6-6V3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
