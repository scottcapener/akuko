"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Avatar } from "@/components/ui/Avatar";
import { getProfile } from "@/lib/profile";
import { buildTextMap, offsetsFromRange, rangeFromOffsets, type TextMap } from "@/lib/shared/anchor";
import type { CommentDTO } from "@/lib/shared/comments";

/** The current user's identity, for the composer's author line (§ Stage 7). */
interface Me {
  name: string;
  avatarUrl: string | null;
}

// Read-view comments (SHARED_WITH_YOU.md §3.4). Lives in a rail to the right of
// the prose, inside the SAME scroll container, so cards scroll with the text.
// Highlight a range → a composer opens anchored to it; saved comments render as
// cards vertically anchored to their highlights, cascading down with a 10px gap.
// Highlights are painted with the CSS Custom Highlight API (no DOM mutation of
// the immutable snapshot).

const GAP = 10;
const RAIL_WIDTH = 320;

interface Props {
  sharedChapterId: string;
  currentUserId: string;
  /** The shared scroll container (prose + this rail live inside it). */
  scrollRef: RefObject<HTMLElement | null>;
  /** The prose <article> holding the scenes (each tagged data-shared-scene-id). */
  proseRef: RefObject<HTMLElement | null>;
  /** Bumped by the page whenever the prose finishes (re)rendering, so we rebuild maps. */
  proseReady: number;
}

interface Composer {
  sharedSceneId: string;
  quoteStart: number;
  quoteEnd: number;
  quoteText: string;
  anchorY: number; // content-Y of the highlight center
}

export function ReadComments({
  sharedChapterId,
  currentUserId,
  scrollRef,
  proseRef,
  proseReady,
}: Props) {
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The Comments toggle moved out of the Read Header into this rail's own header
  // (Stage 6). Collapsed → a thin strip showing just the icon, so the reader can
  // reopen it; the prose widens meanwhile.
  const [collapsed, setCollapsed] = useState(false);
  // The current user's identity for the composer's author line (Stage 7 / 7.3).
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProfile(currentUserId)
      .then((p) => {
        if (!cancelled) setMe({ name: p.displayName || p.penName || "You", avatarUrl: p.avatarUrl });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUserId]);

  const isOwner = ownerId != null && currentUserId === ownerId;
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const composerRef = useRef<HTMLDivElement>(null);
  // Per-scene text maps, rebuilt when the prose (re)renders.
  const mapsRef = useRef<Map<string, TextMap>>(new Map());

  // ── Load comments ──
  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?sharedChapterId=${encodeURIComponent(sharedChapterId)}`);
    if (!res.ok) return;
    const data = await res.json();
    setComments(data.comments ?? []);
    setOwnerId(data.ownerId ?? null);
  }, [sharedChapterId]);

  useEffect(() => {
    load();
  }, [load]);

  // Rebuild the per-scene text maps from the current DOM. Called from relayout
  // (a layout effect) so maps are always fresh before anchors are measured —
  // building them in a passive effect races the layout effect that consumes them.
  const rebuildMaps = useCallback(() => {
    const prose = proseRef.current;
    if (!prose) return;
    const maps = new Map<string, TextMap>();
    prose.querySelectorAll<HTMLElement>("[data-shared-scene-id] [data-scene-body]").forEach((el) => {
      const sceneEl = el.closest<HTMLElement>("[data-shared-scene-id]");
      const id = sceneEl?.dataset.sharedSceneId;
      if (id) maps.set(id, buildTextMap(el));
    });
    mapsRef.current = maps;
  }, [proseRef]);

  // ── Selection → composer ──
  useEffect(() => {
    const prose = proseRef.current;
    const scroll = scrollRef.current;
    if (!prose || !scroll) return;

    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const sceneEl = (range.commonAncestorContainer as Node).parentElement?.closest<HTMLElement>(
        "[data-shared-scene-id]"
      );
      if (!sceneEl || !prose!.contains(sceneEl)) return;
      const sharedSceneId = sceneEl.dataset.sharedSceneId!;
      let map = mapsRef.current.get(sharedSceneId);
      if (!map) {
        rebuildMaps();
        map = mapsRef.current.get(sharedSceneId);
      }
      if (!map) return;
      const offsets = offsetsFromRange(map, range);
      if (!offsets) return;

      const rect = range.getBoundingClientRect();
      const scrollRect = scroll!.getBoundingClientRect();
      const anchorY = rect.top + rect.height / 2 - scrollRect.top + scroll!.scrollTop;

      setComposer({
        sharedSceneId,
        quoteStart: offsets.start,
        quoteEnd: offsets.end,
        quoteText: offsets.text,
        anchorY,
      });
      setActiveId(null);
    }

    prose.addEventListener("mouseup", onMouseUp);
    return () => prose.removeEventListener("mouseup", onMouseUp);
  }, [proseRef, scrollRef, proseReady, rebuildMaps]);

  // ── Paint highlights (Custom Highlight API) ──
  useEffect(() => {
    type HL = { add(r: Range): void };
    const win = window as unknown as {
      CSS?: { highlights?: { set(k: string, v: HL): void; delete(k: string): void } };
      Highlight?: new (...ranges: Range[]) => HL;
    };
    const CSSHighlights = win.CSS?.highlights;
    const HighlightCtor = win.Highlight;
    if (!CSSHighlights || !HighlightCtor) return; // unsupported → cards still work, no tint

    const inactive = new HighlightCtor();
    const active = new HighlightCtor();
    const resolved = new HighlightCtor();

    const draw = (c: CommentDTO, target: HL) => {
      const map = mapsRef.current.get(c.sharedSceneId);
      if (!map) return;
      const r = rangeFromOffsets(map, c.quoteStart, c.quoteEnd);
      if (r) target.add(r);
    };

    for (const c of comments) {
      if (c.stale) continue; // offsets index into old text — never paint (§7)
      if (c.resolvedAt) draw(c, resolved);
      else if (c.id === activeId) draw(c, active);
      else draw(c, inactive);
    }
    // The composer's pending range reads as active.
    if (composer) {
      const map = mapsRef.current.get(composer.sharedSceneId);
      const r = map && rangeFromOffsets(map, composer.quoteStart, composer.quoteEnd);
      if (r) active.add(r);
    }

    CSSHighlights.set("hc-comment-inactive", inactive);
    CSSHighlights.set("hc-comment-active", active);
    CSSHighlights.set("hc-comment-resolved", resolved);

    return () => {
      CSSHighlights.delete("hc-comment-inactive");
      CSSHighlights.delete("hc-comment-active");
      CSSHighlights.delete("hc-comment-resolved");
    };
  }, [comments, activeId, composer, proseReady]);

  // Stale comments (§7) index into text that has since changed, so they can't be
  // anchored in the prose; they still show, listed at the top of the rail. Stage 7
  // shows them (and resolved comments) unconditionally — no "show N" toggles.
  const staleComments = comments.filter((c) => c.stale);

  // ── Stacking layout — measure anchors + card heights, cascade downward ──
  // Resolved comments stay in the cascade (anchored, dimmed) rather than hiding.
  const visible = comments.filter((c) => !c.stale);
  // Sort by scene order then quote position (§3.4).
  const ordered = [...visible].sort(
    (a, b) => a.scenePosition - b.scenePosition || a.quoteStart - b.quoteStart
  );

  const relayout = useCallback((rebuild = false) => {
    const scroll = scrollRef.current;
    const prose = proseRef.current;
    if (!scroll || !prose) return;
    if (rebuild) rebuildMaps();
    const scrollTop = scroll.scrollTop;
    const scrollRectTop = scroll.getBoundingClientRect().top;

    // First scene's content-Y — cards may never rise above it.
    const firstScene = prose.querySelector<HTMLElement>("[data-shared-scene-id]");
    const minTop = firstScene
      ? firstScene.getBoundingClientRect().top - scrollRectTop + scrollTop
      : 0;

    let prevBottom = -Infinity;
    for (const c of ordered) {
      const el = cardRefs.current.get(c.id);
      if (!el) continue;
      const map = mapsRef.current.get(c.sharedSceneId);
      const r = map && rangeFromOffsets(map, c.quoteStart, c.quoteEnd);
      const rect = r?.getBoundingClientRect();
      const centerY = rect
        ? rect.top + rect.height / 2 - scrollRectTop + scrollTop
        : minTop;
      const desired = Math.max(minTop, centerY - el.offsetHeight / 2);
      const top = Math.max(desired, prevBottom + GAP);
      el.style.top = `${top}px`;
      prevBottom = top + el.offsetHeight;
    }

    // Composer floats at its own anchor, clamped below the last card.
    if (composerRef.current && composer) {
      const top = Math.max(minTop, composer.anchorY - composerRef.current.offsetHeight / 2);
      composerRef.current.style.top = `${top}px`;
    }

    // Grow the rail so absolutely-positioned cards are all scrollable.
    if (railRef.current) {
      railRef.current.style.minHeight = `${prose.offsetHeight}px`;
    }
  }, [ordered, composer, scrollRef, proseRef, rebuildMaps]);

  // Rebuild maps + reposition after every render (before paint). Scroll/resize
  // reuse the maps (text is immutable) — see the scroll effect below.
  useLayoutEffect(() => {
    relayout(true);
  });

  // Re-run layout on scroll (anchors move relative to the viewport) + resize.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => relayout();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [relayout, scrollRef]);

  // ── Actions ──
  async function createComment(body: string) {
    if (!composer) return;
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedChapterId,
        sharedSceneId: composer.sharedSceneId,
        body,
        quoteText: composer.quoteText,
        quoteStart: composer.quoteStart,
        quoteEnd: composer.quoteEnd,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setComments((prev) => [...prev, data.comment]);
      setComposer(null);
      setActiveId(data.comment.id);
    }
  }

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
    }
  }

  return (
    <aside
      ref={railRef}
      className="relative flex-shrink-0 border-l border-border-subtle"
      style={{ width: collapsed ? 48 : RAIL_WIDTH }}
    >
      {/* Panel header — the Comments icon (Stage 6), sticky so it pins to the top
          of the reading viewport like the other column headers. Doubles as the
          collapse toggle. */}
      <div className="sticky top-0 z-30 h-16 bg-bg flex items-center px-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-pressed={!collapsed}
          aria-label={collapsed ? "Show comments" : "Hide comments"}
          title="Comments"
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            collapsed ? "text-subtle hover:text-text hover:bg-hover" : "text-text bg-hover"
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1120 12z" />
          </svg>
        </button>
      </div>

      {/* Stale comments (§7) can't anchor to the changed prose, so they list here
          at the top of the rail rather than in the cascade. Stage 7: shown
          unconditionally — no "show N from a previous version" toggle. */}
      {!collapsed && staleComments.length > 0 && (
        <div className="sticky top-[4.5rem] z-20 mx-3 mt-2 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {staleComments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              active={false}
              isMine={c.authorId === currentUserId}
              isOwner={isOwner}
              onSelect={() => {}}
              onEdit={(body) => editComment(c.id, body)}
              onDelete={() => deleteComment(c.id)}
              onToggleResolved={() => toggleResolved(c)}
            />
          ))}
        </div>
      )}

      {!collapsed && composer && (
        <div ref={composerRef} className="absolute right-3 left-3" style={{ top: 0 }}>
          <Composer
            author={me}
            onCancel={() => setComposer(null)}
            onSubmit={createComment}
          />
        </div>
      )}

      {!collapsed && ordered.map((c) => (
        <div
          key={c.id}
          ref={(el) => {
            if (el) cardRefs.current.set(c.id, el);
            else cardRefs.current.delete(c.id);
          }}
          className="absolute right-3 left-3"
          style={{ top: 0 }}
          onMouseEnter={() => !c.resolvedAt && setActiveId(c.id)}
        >
          <CommentCard
            comment={c}
            active={c.id === activeId}
            isMine={c.authorId === currentUserId}
            isOwner={isOwner}
            onSelect={() => setActiveId(c.id)}
            onEdit={(body) => editComment(c.id, body)}
            onDelete={() => deleteComment(c.id)}
            onToggleResolved={() => toggleResolved(c)}
          />
        </div>
      ))}

      {!collapsed && comments.length === 0 && !composer && (
        <p className="px-4 pt-6 text-center text-xs text-subtle/60">Comments will appear here.</p>
      )}

    </aside>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function Composer({
  author,
  onSubmit,
  onCancel,
}: {
  author: Me | null;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit() {
    const body = value.trim();
    if (body) onSubmit(body);
  }

  return (
    <div className="bg-panel border border-accent/60 rounded-xl p-3 shadow-lg">
      {/* Author profile line — the composer always shows who's commenting (7.3). */}
      <div className="flex items-center gap-2 mb-2">
        <Avatar name={author?.name ?? "You"} src={author?.avatarUrl ?? null} size={22} />
        <span className="text-text text-xs font-medium truncate">{author?.name ?? "You"}</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Add comment…"
        rows={2}
        className="w-full bg-transparent text-text text-sm placeholder:text-subtle/50 resize-none focus:outline-none"
      />
      {/* Cancel / Save — the checkmark is reserved for resolve only (7.2). */}
      <div className="flex justify-end gap-2 mt-1.5">
        <button onClick={onCancel} className="text-xs text-subtle hover:text-text transition-colors">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="text-xs text-accent hover:text-accent-hi font-medium disabled:opacity-30 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Comment card ──────────────────────────────────────────────────────────────

function CommentCard({
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
      className={`bg-panel rounded-xl p-3 border transition-colors ${
        active ? "border-accent/60" : "border-border-subtle hover:border-hover"
      } ${resolved ? "opacity-60" : ""}`}
    >
      {/* Author profile line — always shown (Stage 7); no quoted snippet. */}
      <div className="flex items-center gap-2">
        <Avatar name={comment.authorName} src={comment.authorAvatarUrl} size={22} />
        <span className="text-text text-xs font-medium flex-1 truncate">{comment.authorName}</span>

        <div className="flex items-center gap-1 flex-shrink-0 text-subtle">
          {/* Resolve / re-open — chapter owner only. */}
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
          {/* Delete — author only. */}
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
        <div className="mt-2">
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
              onClick={(e) => {
                e.stopPropagation();
                setDraft(comment.body);
                setEditing(false);
              }}
              className="text-xs text-subtle hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                saveEdit();
              }}
              className="text-xs text-accent hover:text-accent-hi font-medium"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p
          className={`mt-1.5 text-sm text-text whitespace-pre-wrap ${isMine && !resolved ? "cursor-text" : ""}`}
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
