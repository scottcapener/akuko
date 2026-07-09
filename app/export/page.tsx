"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import * as db from "@/lib/db";
import type { BookSummary, ExportSummary, ChapterRef } from "@/lib/db";
import { Button, Modal } from "@/components/ui";

// ── Helpers ──────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Confirmation modal (mirrors the Backups page) ─────────────────────────────────

function ConfirmModal({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm text-text leading-relaxed">{message}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:bg-accent-hi disabled:opacity-50 transition-colors"
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Kind badge ──────────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: "full" | "partial" }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-panel border border-border-subtle text-[10px] font-medium text-subtle tracking-wide">
      {kind === "partial" ? "Partial" : "Full"}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterRef[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [partialMode, setPartialMode] = useState(false);
  const [exports, setExports] = useState<ExportSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExportSummary | null>(null);

  const refreshExports = useCallback(async (uid: string) => {
    setExports(await db.listExports(uid));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setUserId(user.id);
      const [bookList] = await Promise.all([db.listBooks(user.id), refreshExports(user.id)]);
      setBooks(bookList);
      setSelectedBookId(bookList[0]?.id ?? null);
      setLoading(false);
    })();
  }, [router, refreshExports]);

  // Load chapters whenever the selected book changes; reset any partial selection.
  useEffect(() => {
    if (!selectedBookId) { setChapters([]); return; }
    setPartialMode(false);
    setSelectedChapters(new Set());
    (async () => setChapters(await db.listChaptersForBook(selectedBookId)))();
  }, [selectedBookId]);

  const selectedBook = books.find((b) => b.id === selectedBookId) ?? null;

  const toggleChapter = useCallback((id: string) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const runExport = useCallback(
    async (chapterIds?: string[]) => {
      if (!userId || !selectedBookId || exporting) return;
      setExporting(true);
      setMessage(null);
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId: selectedBookId, ...(chapterIds ? { chapterIds } : {}) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Export failed");
        }
        await refreshExports(userId);
        setMessage({
          kind: "ok",
          text: chapterIds ? "Exported selected chapters." : "Manuscript exported.",
        });
      } catch (err) {
        setMessage({ kind: "err", text: err instanceof Error ? err.message : "Export failed" });
      } finally {
        setExporting(false);
      }
    },
    [userId, selectedBookId, exporting, refreshExports]
  );

  const handleDownload = useCallback(async (exp: ExportSummary) => {
    const url = await db.signExportUrl(exp.storagePath);
    if (!url) {
      setMessage({ kind: "err", text: "Could not generate a download link." });
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }, []);

  const handleDelete = useCallback(async () => {
    if (!userId || !confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await db.deleteExport(confirmDelete.id, confirmDelete.storagePath);
      setConfirmDelete(null);
      await refreshExports(userId);
    } catch {
      setMessage({ kind: "err", text: "Could not delete that export." });
    } finally {
      setDeletingId(null);
    }
  }, [userId, confirmDelete, refreshExports]);

  if (loading) return <div className="min-h-full bg-bg" />;

  const partialCount = selectedChapters.size;

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        {/* Back link */}
        <Link href="/write" className="text-xs text-subtle/60 hover:text-subtle transition-colors self-start">
          ← Back to Hot Cocoa
        </Link>

        <div className="flex items-baseline justify-between">
          <h1 className="text-text text-xl font-semibold">Export</h1>
          <span className="text-xs text-subtle">
            {exports.length} {exports.length === 1 ? "export" : "exports"} · max 10 kept
          </span>
        </div>

        <p className="text-xs text-subtle leading-relaxed -mt-3">
          Export a book to a Word (.docx) manuscript for uploading elsewhere, like KDP.
          Scene descriptions and the Library are left out — this is the prose only.
        </p>

        {books.length === 0 ? (
          <p className="text-xs text-subtle text-center py-8">
            You don’t have any books to export yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-panel p-4">
            {/* Book picker */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-text">Book</span>
                <span className="text-[11px] text-subtle">Which book to export</span>
              </div>
              <select
                value={selectedBookId ?? ""}
                onChange={(e) => setSelectedBookId(e.target.value)}
                className="px-3 py-2 rounded-lg bg-bg border border-border-subtle text-xs text-text max-w-[60%] focus:outline-none focus:border-accent/40"
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </div>

            {/* Full export */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-text">Full manuscript</span>
                <span className="text-[11px] text-subtle">
                  All {chapters.length} {chapters.length === 1 ? "chapter" : "chapters"}, in reading order
                </span>
              </div>
              <button
                onClick={() => runExport()}
                disabled={exporting || !selectedBook || chapters.length === 0}
                className="px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors"
              >
                {exporting ? "Exporting…" : "Export manuscript"}
              </button>
            </div>

            {/* Partial export */}
            <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-text">Sample chapters</span>
                  <span className="text-[11px] text-subtle">A partial manuscript to send an editor</span>
                </div>
                <button
                  onClick={() => setPartialMode((v) => !v)}
                  disabled={chapters.length === 0}
                  className="px-4 py-2 rounded-lg bg-bg border border-border-subtle text-xs font-medium text-text hover:border-accent/40 disabled:opacity-50 transition-colors"
                >
                  {partialMode ? "Cancel" : "Choose chapters"}
                </button>
              </div>

              {partialMode && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle overflow-hidden max-h-64 overflow-y-auto">
                    {chapters.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2 bg-bg cursor-pointer hover:bg-hover transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedChapters.has(c.id)}
                          onChange={() => toggleChapter(c.id)}
                          className="accent-accent"
                        />
                        <span className="text-xs text-text truncate">{c.title}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => runExport([...selectedChapters])}
                    disabled={exporting || partialCount === 0}
                    className="self-start px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors"
                  >
                    {exporting
                      ? "Exporting…"
                      : partialCount === 0
                      ? "Export selected chapters"
                      : `Export ${partialCount} selected ${partialCount === 1 ? "chapter" : "chapters"}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <p className={`text-xs ${message.kind === "ok" ? "text-accent" : "text-error"}`}>
            {message.text}
          </p>
        )}

        {/* Export list */}
        {exports.length === 0 ? (
          <p className="text-xs text-subtle text-center py-8">
            No exports yet. Export a book above to create your first one.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle overflow-hidden">
            {exports.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3 bg-panel">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text truncate">{e.bookTitle}</span>
                    <KindBadge kind={e.kind} />
                  </div>
                  <span className="text-[11px] text-subtle">
                    {formatDate(e.createdAt)} · {e.chapterCount} {e.chapterCount === 1 ? "chapter" : "chapters"} · {formatBytes(e.sizeBytes)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleDownload(e)}
                    className="px-2.5 py-1.5 rounded-md text-[11px] text-subtle hover:text-text hover:bg-hover transition-colors"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setConfirmDelete(e)}
                    className="px-2.5 py-1.5 rounded-md text-[11px] text-subtle hover:text-error hover:bg-hover transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          message={
            <>
              Delete this export of <span className="font-semibold">{confirmDelete.bookTitle}</span>?
              This can’t be undone.
            </>
          }
          confirmLabel="Delete export"
          busy={deletingId !== null}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
