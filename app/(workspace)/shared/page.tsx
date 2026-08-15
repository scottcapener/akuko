"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { Avatar } from "@/components/ui/Avatar";
import { refreshUnread } from "@/lib/useUnread";
import type { FeedItem } from "@/lib/shared/feed";

// The "Shared With You" feed (§3.2). A flat, newest-first list grouped by the day
// it was shared, above it an Author Filter row (Stage 9) that narrows the list to
// one author at a time. Each row is a card: chapter + book on the left; author,
// unread pill, time, and a ••• (remove from your list) on the right.

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function NewPill() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-on-accent bg-accent rounded-full px-2 py-0.5 leading-none">
      New
    </span>
  );
}

interface AuthorChip {
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  hasUnread: boolean;
}

export default function SharedFeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  // Author filter (§3.2 / 9.2): one author at a time; click again to clear.
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login?next=/shared");
        return;
      }
      try {
        const res = await fetch("/api/shared");
        const data = await res.json();
        if (!cancelled) setItems(res.ok ? data.items : []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function removeFromList(id: string) {
    setMenuOpenId(null);
    // Optimistic — drop it locally, then revoke my own grant server-side (§7).
    setItems((prev) => (prev ?? []).filter((i) => i.sharedChapterId !== id));
    try {
      await fetch(`/api/shared/${id}`, { method: "DELETE" });
      refreshUnread(); // its unread may have fed the nav badge
    } catch {
      // Best-effort; a failed revoke just means it reappears on next load.
    }
  }

  // Distinct authors, in first-seen (newest-share) order, flagged if any of their
  // chapters in my list is unread (drives the chip's NEW state).
  const authors: AuthorChip[] = [];
  {
    const seen = new Map<string, AuthorChip>();
    for (const it of items ?? []) {
      let a = seen.get(it.authorId);
      if (!a) {
        a = { authorId: it.authorId, authorName: it.authorName, authorAvatarUrl: it.authorAvatarUrl, hasUnread: false };
        seen.set(it.authorId, a);
        authors.push(a);
      }
      if (it.unread) a.hasUnread = true;
    }
  }
  // Filtering by the only author is pointless — show the row once there are ≥2.
  const showFilter = authors.length >= 2;
  const effectiveAuthor = showFilter ? selectedAuthor : null;

  const visible = (items ?? []).filter((i) => !effectiveAuthor || i.authorId === effectiveAuthor);

  // Group consecutive visible items by day bucket (already newest-first).
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of visible) {
    const label = dayBucket(item.sharedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 md:py-14">
      <h1 className="text-text text-2xl font-bold mb-6">Shared with you</h1>

      {/* Author filter row (9.2) */}
      {showFilter && (
        <div className="flex gap-4 overflow-x-auto hc-scroll-hoverbar pb-2 mb-6 -mx-1 px-1">
          {authors.map((a) => {
            const selected = selectedAuthor === a.authorId;
            return (
              <button
                key={a.authorId}
                onClick={() => setSelectedAuthor((cur) => (cur === a.authorId ? null : a.authorId))}
                aria-pressed={selected}
                className="flex flex-col items-center gap-1.5 flex-shrink-0 w-16 group"
                title={a.authorName}
              >
                <span
                  className={`relative rounded-full transition-shadow ${
                    selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
                  }`}
                >
                  <Avatar name={a.authorName} src={a.authorAvatarUrl} size={52} />
                  {a.hasUnread && (
                    <span className="absolute -top-1 -right-2">
                      <NewPill />
                    </span>
                  )}
                </span>
                <span
                  className={`text-[11px] truncate w-full text-center transition-colors ${
                    selected ? "text-text" : "text-subtle group-hover:text-text"
                  }`}
                >
                  {a.authorName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {items === null ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-panel animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-subtle text-sm text-center py-24">Shared chapters will appear here.</p>
      ) : visible.length === 0 ? (
        <p className="text-subtle text-sm text-center py-24">No chapters from this author.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.label + group.items[0].sharedChapterId}>
              <p className="text-label-m uppercase text-subtle mb-2 px-1">{group.label}</p>
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <div
                    key={item.sharedChapterId}
                    className="relative flex items-center gap-3 bg-panel rounded-xl px-4 py-3 hover:bg-hover transition-colors"
                  >
                    {/* Whole-card navigation, under the on-top controls. */}
                    <Link
                      href={`/shared/${item.sharedChapterId}`}
                      aria-label={item.chapterTitle}
                      className="absolute inset-0 rounded-xl"
                    />

                    <div className="flex-1 min-w-0 pointer-events-none">
                      <p className="text-text text-sm font-medium truncate">{item.chapterTitle}</p>
                      {item.bookTitle && (
                        <p className="text-subtle text-xs truncate">{item.bookTitle}</p>
                      )}
                    </div>

                    {/* Author — desktop only; the filter row carries it on mobile. */}
                    <div className="hidden md:flex items-center gap-1.5 flex-shrink-0 pointer-events-none">
                      <Avatar name={item.authorName} src={item.authorAvatarUrl} size={20} />
                      <span className="text-subtle text-xs truncate max-w-[120px]">{item.authorName}</span>
                    </div>

                    {item.unread && <span className="flex-shrink-0 pointer-events-none"><NewPill /></span>}

                    <span className="text-subtle text-xs flex-shrink-0 pointer-events-none">
                      {timeLabel(item.sharedAt)}
                    </span>

                    {/* ••• — remove from your list (§7). Sits above the card link. */}
                    <button
                      onClick={() => setMenuOpenId((cur) => (cur === item.sharedChapterId ? null : item.sharedChapterId))}
                      aria-label="Chapter options"
                      className="relative z-10 flex-shrink-0 w-7 h-7 -mr-1 flex items-center justify-center rounded-md text-subtle hover:text-text hover:bg-bg transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </button>

                    {menuOpenId === item.sharedChapterId && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                        <div className="absolute right-2 top-full z-20 mt-1 w-52 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden">
                          <button
                            onClick={() => removeFromList(item.sharedChapterId)}
                            className="block w-full text-left px-4 py-2.5 text-xs text-error hover:bg-hover transition-colors"
                          >
                            Remove from Shared with you
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
