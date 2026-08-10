"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import * as db from "@/lib/db";
import type { BookSummary } from "@/lib/db";
import { importDocx } from "@/lib/import/docx";
import { Button, Modal } from "@/components/ui";

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
  onDelete,
  onCoverError,
}: {
  book: BookSummary;
  switching: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onCoverError: () => void;
}) {
  // Guards the cover re-sign so a genuinely broken image can't loop.
  const coverRetried = useRef(false);
  return (
    <div className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-panel border border-border-subtle group-hover:ring-1 group-hover:ring-hover transition-all">
        <button
          onClick={onOpen}
          disabled={switching}
          className="absolute inset-0 w-full h-full focus:outline-none"
          title={book.isActive ? `${book.title} (active)` : `Open ${book.title}`}
        >
          {book.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImage}
              alt=""
              className="w-full h-full object-cover"
              onLoad={() => { coverRetried.current = false; }}
              onError={() => {
                if (coverRetried.current) return;
                coverRetried.current = true;
                onCoverError();
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookIcon />
            </div>
          )}

          {/* Hover affordance */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] uppercase tracking-widest">
              {switching ? "Opening…" : book.isActive ? "Continue" : "Open"}
            </span>
          </div>
        </button>

        {book.isActive && (
          <span className="pointer-events-none absolute top-2 left-2 px-2 py-0.5 rounded-full bg-accent text-on-accent text-[10px] font-semibold tracking-wide">
            Active
          </span>
        )}

        {/* Delete affordance */}
        <button
          onClick={onDelete}
          title={`Delete ${book.title}`}
          aria-label={`Delete ${book.title}`}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-red-900/80 hover:text-white flex items-center justify-center transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <button onClick={onOpen} disabled={switching} className="flex flex-col gap-0.5 px-0.5 text-left focus:outline-none">
        <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
          {book.title}
        </span>
        <span className="text-[11px] text-subtle">
          {book.wordCount.toLocaleString()} {book.wordCount === 1 ? "word" : "words"}
        </span>
      </button>
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────────

function DeleteBookModal({
  book,
  busy,
  error,
  onConfirm,
  onBackupThenDelete,
  onCancel,
}: {
  book: BookSummary;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onBackupThenDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm text-text leading-relaxed">
          Delete <span className="font-semibold">{book.title}</span>? This permanently removes the
          book and all of its chapters, scenes, and library. Existing backups are kept and can still
          be restored.
        </p>
        {error && <p className="text-xs text-error leading-relaxed">{error}</p>}
        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-red-900/40 text-error text-xs font-semibold hover:bg-red-900/60 disabled:opacity-50 transition-colors"
          >
            {busy ? "Please wait…" : "Delete book"}
          </button>
          <button
            onClick={onBackupThenDelete}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-panel border border-border-subtle text-text text-xs font-medium hover:border-accent/40 disabled:opacity-50 transition-colors"
          >
            Back up first, then delete
          </button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
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
  const [confirmDelete, setConfirmDelete] = useState<BookSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Re-mint an expired signed cover URL and swap it into the grid.
  const refreshCover = useCallback(async (book: BookSummary) => {
    if (!book.coverImagePath) return;
    const url = await db.signBookCoverUrl(book.coverImagePath);
    if (url) setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, coverImage: url } : b)));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!userId || creating || switchingId) return;
    setCreating(true);
    // createBook sets the new book as active (last_opened_at = now).
    await db.createBook(userId);
    router.push("/write");
  }, [userId, creating, switchingId, router]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // reset so the same file can be picked again
      if (!file || !userId || importing) return;
      setImporting(true);
      setImportError(null);
      try {
        // importDocx makes the new book active; drop the user into the writer.
        await importDocx(userId, file);
        router.push("/write");
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Couldn’t import that document.");
        setImporting(false);
      }
    },
    [userId, importing, router]
  );

  const runDelete = useCallback(
    async (backupFirst: boolean) => {
      if (!userId || !confirmDelete || deleting) return;
      setDeleting(true);
      setDeleteError(null);
      try {
        if (backupFirst) {
          // Snapshot the book before it's gone. If the backup fails (e.g. too
          // large), abort — deleting without the requested backup would be
          // silent data loss.
          const res = await fetch("/api/backup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId: confirmDelete.id }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setDeleteError(`${body.error ?? "Backup failed"} The book was not deleted.`);
            setDeleting(false);
            return;
          }
        }
        await db.deleteBook(confirmDelete.id);
        setConfirmDelete(null);
        setBooks(await db.listBooks(userId));
      } finally {
        setDeleting(false);
      }
    },
    [userId, confirmDelete, deleting]
  );

  if (loading) return <div className="min-h-full bg-bg" />;

  const busy = creating || switchingId !== null;

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-text text-xl font-semibold">Books</h1>
            <span className="text-xs text-subtle">
              {books.length} {books.length === 1 ? "book" : "books"}
            </span>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || importing}
            title="Create a new book from a Word (.docx) manuscript"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {importing ? "Importing…" : "Import docx"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>

        <p className="text-xs text-subtle leading-relaxed -mt-3">
          Select a book to open it in the writer. The most recently opened book is your active book.
        </p>

        {importError && <p className="text-xs text-error -mt-3">{importError}</p>}

        {/* Book grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {books.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              switching={switchingId === b.id}
              onOpen={() => openBook(b.id)}
              onDelete={() => setConfirmDelete(b)}
              onCoverError={() => refreshCover(b)}
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

      {confirmDelete && (
        <DeleteBookModal
          book={confirmDelete}
          busy={deleting}
          error={deleteError}
          onConfirm={() => runDelete(false)}
          onBackupThenDelete={() => runDelete(true)}
          onCancel={() => { setConfirmDelete(null); setDeleteError(null); }}
        />
      )}
    </div>
  );
}
