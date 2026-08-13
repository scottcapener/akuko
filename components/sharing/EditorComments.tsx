"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { findUniqueTextRange } from "@/lib/shared/anchor";
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
}

interface Group {
  sceneId: string | null;
  label: string;
  comments: CommentDTO[];
}

export function EditorComments({ chapterId, scenes, currentUserId, onSceneClick }: Props) {
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [shared, setShared] = useState<boolean | null>(null); // null = loading
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

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
      return;
    }
    setShared(true);
    const res = await fetch(
      `/api/comments?sharedChapterId=${encodeURIComponent(state.sharedChapterId)}`
    );
    if (!res.ok) return;
    const data = await res.json();
    setComments(data.comments ?? []);
    setOwnerId(data.ownerId ?? null);
  }, [chapterId]);

  useEffect(() => {
    setComments([]);
    setActiveId(null);
    setShared(null);
    load();
  }, [load]);

  // ── Tier-2 highlight — paint the active card's quote in the live scene ──
  useEffect(() => {
    type HL = { add(r: Range): void };
    const win = window as unknown as {
      CSS?: { highlights?: { set(k: string, v: HL): void; delete(k: string): void } };
      Highlight?: new (...ranges: Range[]) => HL;
    };
    const highlights = win.CSS?.highlights;
    const HighlightCtor = win.Highlight;
    if (!highlights || !HighlightCtor) return; // unsupported → cards still work

    const active = comments.find((c) => c.id === activeId);
    if (active?.sceneId) {
      const body = document.querySelector<HTMLElement>(
        `[data-scene-id="${CSS.escape(active.sceneId)}"] [contenteditable]`
      );
      const range = body && findUniqueTextRange(body, active.quoteText);
      if (range) {
        const hl = new HighlightCtor(range);
        highlights.set("hc-comment-active", hl);
        return () => highlights.delete("hc-comment-active");
      }
    }
    highlights.delete("hc-comment-active");
  }, [activeId, comments]);

  // Clear any lingering highlight when the tab unmounts (chapter switch, etc.).
  useEffect(() => {
    return () => {
      const win = window as unknown as {
        CSS?: { highlights?: { delete(k: string): void } };
      };
      win.CSS?.highlights?.delete("hc-comment-active");
    };
  }, []);

  // ── Actions (RLS enforces permissions; UI mirrors §3.4) ──
  async function editComment(id: string, body: string) {
    const res = await fetch(`/api/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)));
  }

  async function deleteComment(id: string) {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  }

  async function toggleResolved(c: CommentDTO) {
    const resolved = !c.resolvedAt;
    const res = await fetch(`/api/comments/${c.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    if (res.ok) {
      setComments((prev) =>
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

  // ── Group by scene, in scene order (§3.7 tier 1) ──
  const visible = comments.filter((c) => showResolved || !c.resolvedAt);
  const scenePos = new Map(scenes.map((s, i) => [s.id, i]));
  const sceneLabel = new Map(scenes.map((s) => [s.id, s.label]));
  const groups: Group[] = [];
  const byScene = new Map<string, Group>();
  for (const c of [...visible].sort(
    (a, b) => a.scenePosition - b.scenePosition || a.quoteStart - b.quoteStart
  )) {
    const key = c.sceneId ?? "__none__";
    let g = byScene.get(key);
    if (!g) {
      g = {
        sceneId: c.sceneId,
        label:
          (c.sceneId && sceneLabel.get(c.sceneId)) || "Untitled scene",
        comments: [],
      };
      byScene.set(key, g);
      groups.push(g);
    }
    g.comments.push(c);
  }
  // Order groups by the live scene position (falls back to snapshot order).
  groups.sort((a, b) => {
    const pa = a.sceneId != null ? scenePos.get(a.sceneId) ?? Infinity : Infinity;
    const pb = b.sceneId != null ? scenePos.get(b.sceneId) ?? Infinity : Infinity;
    return pa - pb;
  });

  const resolvedCount = comments.filter((c) => c.resolvedAt).length;

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
          Comments your readers leave will appear here, grouped by scene.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {resolvedCount > 0 && (
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="mb-3 px-2.5 py-1 rounded-md bg-panel border border-border-subtle text-xs text-subtle hover:text-text transition-colors"
        >
          {showResolved ? "Hide" : "Show"} {resolvedCount} resolved
        </button>
      )}

      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.sceneId ?? "__none__"}>
            <p className="text-label-m uppercase text-subtle mb-2 truncate">{g.label}</p>
            <div className="flex flex-col gap-2">
              {g.comments.map((c) => (
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
  const resolved = !!comment.resolvedAt;

  function saveEdit() {
    const body = draft.trim();
    if (body && body !== comment.body) onEdit(body);
    setEditing(false);
  }

  return (
    <div
      onClick={onSelect}
      className={`bg-panel rounded-xl p-3 border cursor-pointer transition-colors ${
        active ? "border-accent/60" : "border-border-subtle hover:border-hover"
      } ${resolved ? "opacity-60" : ""}`}
    >
      {/* Quoted snapshot text — the anchor, shown since there's no adjacent rail. */}
      <p className="text-[11px] text-subtle border-l-2 border-hover pl-2 mb-2 line-clamp-2 italic">
        {comment.quoteText}
      </p>

      <div className="flex items-center gap-2">
        <Avatar name={comment.authorName} src={comment.authorAvatarUrl} size={20} />
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
          {isMine && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
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

      {editing ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
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
            autoFocus
            className="w-full bg-bg border border-hover rounded-lg p-2 text-text text-sm resize-none focus:outline-none focus:border-accent/60"
          />
          <div className="flex justify-end gap-2 mt-1.5">
            <button
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              className="text-xs text-subtle hover:text-text"
            >
              Cancel
            </button>
            <button onClick={saveEdit} className="text-xs text-accent hover:text-accent-hi font-medium">
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
            if (isMine && !resolved) {
              e.stopPropagation();
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
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v6h6M3 13a9 9 0 103-6.7L3 9" />
    </svg>
  );
}
