"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import * as db from "@/lib/db";
import type { BookSummary } from "@/lib/db";

// ── Book cover icon (placeholder when no cover image) ───────────────────────────

function BookIcon() {
  return (
    <svg className="w-6 h-6 text-subtle opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

// ── Single book card ────────────────────────────────────────────────────────────

function BookCard({
  book,
  switching,
  onOpen,
}: {
  book: BookSummary;
  switching: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      disabled={switching}
      className="group flex flex-col gap-2 text-left focus:outline-none"
      title={book.isActive ? `${book.title} (active)` : `Open ${book.title}`}
    >
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-panel border border-border-subtle group-hover:ring-1 group-hover:ring-hover transition-all">
        {book.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.coverImage} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookIcon />
          </div>
        )}

        {book.isActive && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-accent text-text text-[10px] font-semibold tracking-wide">
            Active
          </span>
        )}

        {/* Hover affordance */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] uppercase tracking-widest">
            {switching ? "Opening…" : book.isActive ? "Continue" : "Open"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-0.5">
        <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
          {book.title}
        </span>
        <span className="text-[11px] text-subtle">
          {book.wordCount.toLocaleString()} {book.wordCount === 1 ? "word" : "words"}
        </span>
      </div>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function BooksPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setUserId(user.id);
      setBooks(await db.listBooks(user.id));
      setLoading(false);
    })();
  }, [router]);

  const openBook = useCallback(
    async (bookId: string) => {
      if (switchingId || creating) return;
      setSwitchingId(bookId);
      await db.setActiveBook(bookId);
      router.push("/write");
    },
    [router, switchingId, creating]
  );

  const handleCreate = useCallback(async () => {
    if (!userId || creating || switchingId) return;
    setCreating(true);
    // createBook sets the new book as active (last_opened_at = now).
    await db.createBook(userId);
    router.push("/write");
  }, [userId, creating, switchingId, router]);

  if (loading) return <div className="min-h-full bg-bg" />;

  const busy = creating || switchingId !== null;

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        {/* Back link */}
        <Link href="/write" className="text-xs text-subtle/60 hover:text-subtle transition-colors self-start">
          ← Back to Hot Cocoa
        </Link>

        <div className="flex items-baseline justify-between">
          <h1 className="text-text text-xl font-semibold">Books</h1>
          <span className="text-xs text-subtle">
            {books.length} {books.length === 1 ? "book" : "books"}
          </span>
        </div>

        <p className="text-xs text-subtle leading-relaxed -mt-3">
          Select a book to open it in the writer. The most recently opened book is your active book.
        </p>

        {/* Book grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {books.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              switching={switchingId === b.id}
              onOpen={() => openBook(b.id)}
            />
          ))}

          {/* New book */}
          <button
            onClick={handleCreate}
            disabled={busy}
            className="aspect-[2/3] rounded-md border border-dashed border-hover text-subtle hover:border-muted/40 hover:text-text disabled:opacity-50 transition-colors flex flex-col items-center justify-center gap-2 self-start"
            title="Create a new book"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-[10px] uppercase tracking-widest select-none">
              {creating ? "Creating…" : "New book"}
            </span>
          </button>
        </div>

      </div>
    </div>
  );
}
