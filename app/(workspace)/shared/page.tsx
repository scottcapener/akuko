"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { Avatar } from "@/components/ui/Avatar";
import type { FeedItem } from "@/lib/shared/feed";

// The "Shared With You" feed (§3.2). Lives in the Workspace shell (NavPanel);
// the page title is "Shared with you" even though the nav label is "Shared".
// A flat, newest-first list, grouped by the day it was shared.

function CoverThumb({ url, alt }: { url: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const show = url && !broken;
  return (
    <span className="h-14 aspect-[2/3] flex-shrink-0 rounded overflow-hidden bg-panel border border-border-subtle flex items-center justify-center">
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <svg className="w-5 h-5 text-subtle opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      )}
    </span>
  );
}

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

export default function SharedFeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[] | null>(null);

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

  // Group consecutive items by day bucket (items already newest-first).
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of items ?? []) {
    const label = dayBucket(item.sharedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 md:py-14">
      <h1 className="text-text text-2xl font-bold mb-8">Shared with you</h1>

      {items === null ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-panel animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-subtle text-sm text-center py-24">Shared chapters will appear here.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.label + group.items[0].sharedChapterId}>
              <p className="text-label-m uppercase text-subtle mb-2 px-1">{group.label}</p>
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <Link
                    key={item.sharedChapterId}
                    href={`/shared/${item.sharedChapterId}`}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-panel transition-colors"
                  >
                    <CoverThumb url={item.coverUrl} alt={item.bookTitle} />
                    <div className="flex-1 min-w-0">
                      <p className="text-text text-sm font-medium truncate">{item.chapterTitle}</p>
                      {item.bookTitle && (
                        <p className="text-subtle text-xs truncate">{item.bookTitle}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <Avatar name={item.authorName} src={item.authorAvatarUrl} size={16} />
                        <span className="text-subtle text-xs truncate">{item.authorName}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {item.unread && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-on-accent bg-accent rounded-full px-2 py-0.5">
                          New
                        </span>
                      )}
                      <span className="text-subtle text-xs">{timeLabel(item.sharedAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
