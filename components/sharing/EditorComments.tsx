"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { findUniqueTextRange } from "@/lib/shared/anchor";
import { refreshUnread } from "@/lib/useUnread";
import type { CommentDTO } from "@/lib/shared/comments";
import type { Scene } from "@/lib/types";

// Editor Comments tab (SHARED_WITH_YOU.md §3.7). Reaches the author where they
// write: the live Chapter Editor. Comments join back to live scenes by
// scene_id, so two tiers work off the one link —
//   Tier 1 (always): group this chapter's comments by scene, in scene order.
//     Each card shows the quoted snapshot text + the comment + the author, and
//     clicking it scrolls the editor to that scene (the Book-Panel mechanism).
//   Tier 2 (opportunistic): search the *live* scene for the quote; a lone match
//     is highlighted while the card is active. Zero/many → no highlight.
// Resolve works from here too; permissions match §3.4. No offset math — the
// snapshot's character offsets don't index into the author's edited text.

interface Props {
  /** The live chapter id (matches SceneBlock's data-scene-id root). */
  chapterId: string;
  /** Live scenes of this chapter — for group labels + tier-2 highlight lookup. */
  scenes: Scene[];
  currentUserId: string;
  /** Scrolls the editor to a live scene (reused Book-Panel scene-scroll). */
  onSceneClick?: (chapterId: string, sceneId: string) => void;
  /**
   * Whether the Comments tab is the one on screen. On desktop the tab stays
   * mounted behind the Library so the two can cross-slide, so "opening" it is a
   * prop flip, not a mount — the read cursor must only advance while it's
   * actually visible (§6), or unread badges would clear the instant a chapter
   * loads. Defaults true for the mobile panel, where it's only rendered when shown.
   */
  active?: boolean;
}

// The tab unmounts every time the author switches back to the Library tab, and
// re-mounting used to reset to a skeleton and re-fetch — a visible flash on each
// switch. Cache the last-loaded conversation per chapter (module scope, survives
// unmount) so a re-mount paints the known state immediately and revalidates in
// the background. Fresh chapters still show the skeleton once, which is honest.
type CachedComments = {
  shared: boolean;
  comments: CommentDTO[];
  ownerId: string | null;
  sharedChapterId: string | null;
};
const commentsCache = new Map<string, CachedComments>();

export function EditorComments({
  chapterId,
  currentUserId,
  onSceneClick,
  active = true,
}: Props) {
  const seeded = commentsCache.get(chapterId);
  const [comments, setComments] = useState<CommentDTO[]>(seeded?.comments ?? []);
  const [ownerId, setOwnerId] = useState<string | null>(seeded?.ownerId ?? null);
  const [sharedChapterId, setSharedChapterId] = useState<string | null>(seeded?.sharedChapterId ?? null);
  const [shared, setShared] = useState<boolean | null>(seeded?.shared ?? null); // null = loading
  const [activeId, setActiveId] = useState<string | null>(null);

  const isOwner = ownerId != null && currentUserId === ownerId;

  // ── Load: live chapter → its snapshot → the shared conversation ──
  const load = useCallback(async () => {
    const stateRes = await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`);
    if (!stateRes.ok) {
      setShared(false);
      return;
    }
    const state = await stateRes.json();
    if (!state.sharedChapterId) {
      setShared(false);
      setComments([]);
      setSharedChapterId(null);
      commentsCache.set(chapterId, { shared: false, comments: [], ownerId: null, sharedChapterId: null });
      return;
    }
    setShared(true);
    setSharedChapterId(state.sharedChapterId);
    const res = await fetch(
      `/api/comments?sharedChapterId=${encodeURIComponent(state.sharedChapterId)}`
    );
    if (!res.ok) return;
    const data = await res.json();
    const loaded: CommentDTO[] = data.comments ?? [];
    setComments(loaded);
    setOwnerId(data.ownerId ?? null);
    commentsCache.set(chapterId, {
      shared: true,
      comments: loaded,
      ownerId: data.ownerId ?? null,
      sharedChapterId: state.sharedChapterId,
    });
    // NB: advancing the read cursor ("seen") is handled by the active-gated
    // effect below, not here — load() also runs while the tab is mounted but
    // hidden behind the Library, and marking seen then would wrongly clear
    // unread badges before the author has looked (§6).
  }, [chapterId]);

  // Opening the Comments tab is "seeing" this chapter — advance the read cursor
  // so its unread badges clear everywhere (§6). Only while actually visible.
  useEffect(() => {
    if (!active || !sharedChapterId) return;
    fetch("/api/shared/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sharedChapterId }),
    })
      .then(() => refreshUnread())
      .catch(() => {});
  }, [active, sharedChapterId]);

  useEffect(() => {
    // Seed from cache (no skeleton on a revisit); only a never-loaded chapter
    // falls back to the loading state. Then revalidate.
    const cached = commentsCache.get(chapterId);
    setComments(cached?.comments ?? []);
    setOwnerId(cached?.ownerId ?? null);
    setSharedChapterId(cached?.sharedChapterId ?? null);
    setActiveId(null);
    setShared(cached?.shared ?? null);
    load();
  }, [chapterId, load]);

  // Revalidate when the tab is (re)opened, so a conversation that changed while
  // it sat hidden behind the Library refreshes the moment it comes into view.
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // "Update shared copy" re-snapshots the chapter, which can newly stale some
  // comments (§7); reload so they move to the "previous version" group at once.
  useEffect(() => {
    const onUpdated = () => load();
    window.addEventListener("hc:shared-updated", onUpdated);
    return () => window.removeEventListener("hc:shared-updated", onUpdated);
  }, [load]);

  // ── Tier-2 highlight — paint EVERY comment's quote in the live scenes ──
  // The author expects to see what's been commented on the moment the tab opens,
  // not only after selecting a card. So while the tab is visible we search each
  // live scene for every comment's stored quote (tier-2 substring match) and tint
  // it: the selected card gets the accent highlight, resolved ones a muted tint,
  // the rest the subtle inactive tint. A quote that no longer matches uniquely
  // (the author revised it) simply isn't painted — the card still lists it.
  useEffect(() => {
    type HL = { add(r: Range): void };
    const win = window as unknown as {
      CSS?: { highlights?: { set(k: string, v: HL): void; delete(k: string): void } };
      Highlight?: new (...ranges: Range[]) => HL;
    };
    const highlights = win.CSS?.highlights;
    const HighlightCtor = win.Highlight;
    if (!highlights || !HighlightCtor) return; // unsupported → cards still work

    const clear = () => {
      highlights.delete("hc-comment-inactive");
      highlights.delete("hc-comment-active");
      highlights.delete("hc-comment-resolved");
    };

    // Only tint the prose while the Comments tab is actually on screen; behind
    // the Library the author is writing and shouldn't see comment highlights.
    if (!active) {
      clear();
      return;
    }

    const inactive = new HighlightCtor();
    const activeHl = new HighlightCtor();
    const resolved = new HighlightCtor();

    for (const c of comments) {
      if (!c.sceneId) continue;
      const body = document.querySelector<HTMLElement>(
        `[data-scene-id="${CSS.escape(c.sceneId)}"] [contenteditable]`
      );
      const range = body && findUniqueTextRange(body, c.quoteText);
      if (!range) continue;
      if (c.id === activeId) activeHl.add(range);
      else if (c.resolvedAt) resolved.add(range);
      else inactive.add(range);
    }

    highlights.set("hc-comment-inactive", inactive);
    highlights.set("hc-comment-active", activeHl);
    highlights.set("hc-comment-resolved", resolved);
    return clear;
  }, [active, activeId, comments]);

  // Clear any lingering highlights when the tab unmounts (chapter switch, etc.).
  useEffect(() => {
    return () => {
      const win = window as unknown as {
        CSS?: { highlights?: { delete(k: string): void } };
      };
      const h = win.CSS?.highlights;
      h?.delete("hc-comment-inactive");
      h?.delete("hc-comment-active");
      h?.delete("hc-comment-resolved");
    };
  }, []);

  // Update state and the module cache together, so switching tabs after a local
  // edit doesn't momentarily paint the pre-mutation comments from the cache.
  const applyComments = useCallback(
    (fn: (prev: CommentDTO[]) => CommentDTO[]) => {
      setComments((prev) => {
        const next = fn(prev);
        const c = commentsCache.get(chapterId);
        if (c) commentsCache.set(chapterId, { ...c, comments: next });
        return next;
      });
    },
    [chapterId]
  );

  // ── Actions (RLS enforces permissions; UI mirrors §3.4) ──
  async function editComment(id: string, body: string) {
    const res = await fetch(`/api/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) applyComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)));
  }

  async function deleteComment(id: string) {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (res.ok) applyComments((prev) => prev.filter((c) => c.id !== id));
  }

  async function toggleResolved(c: CommentDTO) {
    const resolved = !c.resolvedAt;
    const res = await fetch(`/api/comments/${c.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    if (res.ok) {
      applyComments((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, resolvedAt: resolved ? new Date().toISOString() : null } : x
        )
      );
      // Resolving hides the card (unless resolved are shown); drop its selection
      // so the live-text highlight clears with it.
      if (resolved && activeId === c.id) setActiveId(null);
    }
  }

  function selectCard(c: CommentDTO) {
    setActiveId(c.id);
    if (c.sceneId) onSceneClick?.(chapterId, c.sceneId);
  }

  // Stage 7: one flat list of ALL comments — resolved and formerly-"stale" ones
  // included, no per-scene group headers, no "resolved"/"previous version"
  // toggles. Ordered by scene then position. If a comment no longer applies, the
  // author deletes it. Clicking a card still scrolls the editor to its scene.
  const ordered = [...comments].sort(
    (a, b) => a.scenePosition - b.scenePosition || a.quoteStart - b.quoteStart
  );

  // ── Empty / loading states ──
  if (shared === null) {
    return <div className="px-4 py-6 flex flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 rounded-lg bg-panel animate-pulse" />
      ))}
    </div>;
  }
  if (!shared || comments.length === 0) {
    return (
      <div className="px-6 pt-16 flex flex-col items-center text-center gap-2">
        <p className="text-subtle/70 text-xs">
          {shared ? "No comments yet." : "Share this chapter to start a conversation."}
        </p>
        <p className="text-subtle/40 text-[11px]">
          Comments your readers leave will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-2">
        {ordered.map((c) => (
          <EditorCommentCard
            key={c.id}
            comment={c}
            active={c.id === activeId}
            isMine={c.authorId === currentUserId}
            isOwner={isOwner}
            onSelect={() => selectCard(c)}
            onEdit={(body) => editComment(c.id, body)}
            onDelete={() => deleteComment(c.id)}
            onToggleResolved={() => toggleResolved(c)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Comment card ──────────────────────────────────────────────────────────────

function EditorCommentCard({
  comment,
  active,
  isMine,
  isOwner,
  onSelect,
  onEdit,
  onDelete,
  onToggleResolved,
}: {
  comment: CommentDTO;
  active: boolean;
  isMine: boolean;
  isOwner: boolean;
  onSelect: () => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onToggleResolved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const resolved = !!comment.resolvedAt;
  // The author can always delete their own comment; the chapter owner gains a
  // delete once they've resolved it (§3.4 workflow: resolve → re-open + delete).
  const canDelete = isMine || (isOwner && resolved);
  // Deleting someone else's words (owner clearing a reader's comment) is
  // confirmed; deleting your own is immediate.
  const deleteNeedsConfirm = !isMine;
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Character offset to drop the caret at when edit mode opens (where the click
  // landed); null → fall back to the end of the text.
  const caretRef = useRef<number | null>(null);

  // On entering edit mode, focus the textarea and place the caret where the
  // author clicked (or at the end as a fallback).
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    const pos = caretRef.current ?? el.value.length;
    el.setSelectionRange(pos, pos);
    caretRef.current = null;
  }, [editing]);

  function saveEdit() {
    const body = draft.trim();
    if (body && body !== comment.body) onEdit(body);
    setEditing(false);
  }

  return (
    <div
      onClick={onSelect}
      className={`bg-panel rounded-xl p-3 border-2 cursor-pointer transition-colors ${
        active ? "border-accent" : "border-border-subtle hover:bg-elevated"
      } ${resolved ? "opacity-60" : ""}`}
    >
      {/* Author profile line — always shown (Stage 7); no quoted snippet, no
          scene label. */}
      <div className="flex items-center gap-2">
        <Avatar name={comment.authorName} src={comment.authorAvatarUrl} size={16} />
        <span className="text-text text-xs font-medium flex-1 truncate">{comment.authorName}</span>

        <div className="flex items-center gap-1 flex-shrink-0 text-subtle">
          {isOwner && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleResolved();
              }}
              aria-label={resolved ? "Re-open" : "Mark resolved"}
              title={resolved ? "Re-open" : "Mark resolved"}
              className="hover:text-text transition-colors"
            >
              {resolved ? <UndoIcon /> : <CheckIcon />}
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (deleteNeedsConfirm) setConfirmingDelete(true);
                else onDelete();
              }}
              aria-label="Delete"
              title="Delete"
              className="hover:text-error transition-colors"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            message={
              <>
                Delete {comment.authorName}&rsquo;s comment? This can&rsquo;t be undone.
              </>
            }
            confirmLabel="Delete"
            onConfirm={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        </div>
      )}

      {editing ? (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
              if (e.key === "Escape") {
                setDraft(comment.body);
                setEditing(false);
              }
            }}
            rows={2}
            ref={taRef}
            className="w-full p-0 bg-transparent text-text text-sm resize-none focus:outline-none"
          />
          <div className="flex justify-end items-center gap-2 mt-1.5">
            <button
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              className="text-xs text-subtle hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              className="text-xs font-medium px-3 py-1 rounded-md bg-accent text-on-accent hover:bg-accent-hi transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p
          className={`mt-1.5 text-sm text-text whitespace-pre-wrap ${
            isMine && !resolved ? "cursor-text" : ""
          }`}
          onClick={(e) => {
            // My own comment: tapping the text selects the card AND opens the
            // editor; tapping elsewhere on the card only selects (card onClick).
            if (isMine && !resolved) {
              e.stopPropagation();
              caretRef.current = caretOffsetFromPoint(e.clientX, e.clientY);
              onSelect();
              setEditing(true);
            }
          }}
        >
          {comment.body}
        </p>
      )}
    </div>
  );
}

// Map a click point to a character offset within the text node under it. The
// comment body renders as a single text node, so the offset indexes straight
// into the draft string — used to seat the edit caret where the author clicked.
function caretOffsetFromPoint(x: number, y: number): number | null {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): { offset: number; offsetNode: Node } | null;
  };
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r && r.startContainer.nodeType === Node.TEXT_NODE) return r.startOffset;
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p && p.offsetNode.nodeType === Node.TEXT_NODE) return p.offset;
  }
  return null;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.99999 9.33317L3.37376 6.70694C2.98324 6.31642 2.98324 5.68325 3.37376 5.29273L5.99999 2.6665" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.66666 6H9.66666C10.1482 6 10.625 6.09484 11.0698 6.27911C11.5147 6.46338 11.9189 6.73346 12.2594 7.07394C12.5999 7.41442 12.8699 7.81863 13.0542 8.26349C13.2385 8.70835 13.3333 9.18515 13.3333 9.66667C13.3333 10.1482 13.2385 10.625 13.0542 11.0698C12.8699 11.5147 12.5999 11.9189 12.2594 12.2594C11.9189 12.5999 11.5147 12.87 11.0698 13.0542C10.625 13.2385 10.1482 13.3333 9.66666 13.3333H7.33332" />
    </svg>
  );
}
