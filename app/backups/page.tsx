"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import * as db from "@/lib/db";
import type { BackupSummary, BackupCadence } from "@/lib/db";
import { restoreBackup, UnsupportedBackupError } from "@/lib/backup/restore";
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

// ── Confirmation modal (mirrors LeftColumn's ConfirmModal) ─────────────────────────

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
            className="px-4 py-2 rounded-lg bg-accent text-text text-xs font-semibold hover:bg-accent-hi disabled:opacity-50 transition-colors"
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Trigger badge ──────────────────────────────────────────────────────────────────

function TriggerBadge({ trigger }: { trigger: "manual" | "auto" }) {
  const label = trigger === "auto" ? "Auto" : "Manual";
  return (
    <span className="px-2 py-0.5 rounded-full bg-panel border border-border-subtle text-[10px] font-medium text-subtle tracking-wide">
      {label}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function BackupsPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [activeBook, setActiveBook] = useState<{ id: string; title: string; cadence: BackupCadence } | null>(null);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [confirmRestore, setConfirmRestore] = useState<BackupSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BackupSummary | null>(null);

  const refresh = useCallback(async (uid: string) => {
    const [list, meta] = await Promise.all([db.listBackups(uid), db.getActiveBookMeta(uid)]);
    setBackups(list);
    setActiveBook(meta);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setUserId(user.id);
      await refresh(user.id);
      setLoading(false);
    })();
  }, [router, refresh]);

  const handleBackupNow = useCallback(async () => {
    if (!userId || backingUp) return;
    setBackingUp(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Backup failed");
      }
      await refresh(userId);
      setMessage({ kind: "ok", text: "Backup created." });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Backup failed" });
    } finally {
      setBackingUp(false);
    }
  }, [userId, backingUp, refresh]);

  const handleCadenceChange = useCallback(
    async (cadence: BackupCadence) => {
      if (!activeBook) return;
      setActiveBook({ ...activeBook, cadence });
      await db.setBookCadence(activeBook.id, cadence);
    },
    [activeBook]
  );

  const handleDownload = useCallback(async (backup: BackupSummary) => {
    const url = await db.signBackupUrl(backup.storagePath);
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

  const handleRestore = useCallback(async () => {
    if (!userId || !confirmRestore) return;
    setRestoringId(confirmRestore.id);
    setMessage(null);
    try {
      await restoreBackup(userId, confirmRestore.storagePath);
      setConfirmRestore(null);
      setMessage({ kind: "ok", text: `Restored "${confirmRestore.bookTitle}" as a new book.` });
      await refresh(userId);
    } catch (err) {
      const text =
        err instanceof UnsupportedBackupError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Restore failed";
      setMessage({ kind: "err", text });
      setConfirmRestore(null);
    } finally {
      setRestoringId(null);
    }
  }, [userId, confirmRestore, refresh]);

  const handleDelete = useCallback(async () => {
    if (!userId || !confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await db.deleteBackup(confirmDelete.id, confirmDelete.storagePath);
      setConfirmDelete(null);
      await refresh(userId);
    } catch {
      setMessage({ kind: "err", text: "Could not delete that backup." });
    } finally {
      setDeletingId(null);
    }
  }, [userId, confirmDelete, refresh]);

  if (loading) return <div className="min-h-full bg-bg" />;

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        {/* Back link */}
        <Link href="/write" className="text-xs text-subtle/60 hover:text-subtle transition-colors self-start">
          ← Back to Hot Cocoa
        </Link>

        <div className="flex items-baseline justify-between">
          <h1 className="text-text text-xl font-semibold">Backups</h1>
          <span className="text-xs text-subtle">
            {backups.length} {backups.length === 1 ? "backup" : "backups"} · max 10 kept
          </span>
        </div>

        <p className="text-xs text-subtle leading-relaxed -mt-3">
          A backup is a complete, downloadable snapshot of a book — text and images.
          Restoring always creates a new book; it never overwrites what you have.
        </p>

        {/* Controls */}
        <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text">
                {activeBook ? activeBook.title : "No active book"}
              </span>
              <span className="text-[11px] text-subtle">Active book — the target of a new backup</span>
            </div>
            <button
              onClick={handleBackupNow}
              disabled={backingUp || !activeBook}
              className="px-4 py-2 rounded-lg bg-accent text-text text-xs font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors"
            >
              {backingUp ? "Backing up…" : "Back up now"}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text">Automatic backups</span>
              <span className="text-[11px] text-subtle">How often the active book backs itself up</span>
            </div>
            <select
              value={activeBook?.cadence ?? "off"}
              onChange={(e) => handleCadenceChange(e.target.value as BackupCadence)}
              disabled={!activeBook}
              className="px-3 py-2 rounded-lg bg-bg border border-border-subtle text-xs text-text disabled:opacity-50 focus:outline-none focus:border-accent/40"
            >
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text">Google Drive</span>
              <span className="text-[11px] text-subtle">Store backups in your own cloud</span>
            </div>
            <button
              disabled
              title="Coming soon"
              className="px-4 py-2 rounded-lg bg-bg border border-border-subtle text-xs font-medium text-subtle/60 cursor-not-allowed"
            >
              Connect Google Drive · Coming soon
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <p className={`text-xs ${message.kind === "ok" ? "text-accent" : "text-error"}`}>
            {message.text}
          </p>
        )}

        {/* Backup list */}
        {backups.length === 0 ? (
          <p className="text-xs text-subtle text-center py-8">
            No backups yet. Use “Back up now” to create your first one.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle overflow-hidden">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 bg-panel">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text truncate">{b.bookTitle}</span>
                    <TriggerBadge trigger={b.trigger} />
                  </div>
                  <span className="text-[11px] text-subtle">
                    {formatDate(b.createdAt)} · {formatBytes(b.sizeBytes)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleDownload(b)}
                    className="px-2.5 py-1.5 rounded-md text-[11px] text-subtle hover:text-text hover:bg-hover transition-colors"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setConfirmRestore(b)}
                    disabled={restoringId !== null}
                    className="px-2.5 py-1.5 rounded-md text-[11px] text-subtle hover:text-text hover:bg-hover disabled:opacity-50 transition-colors"
                  >
                    {restoringId === b.id ? "Restoring…" : "Restore"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(b)}
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

      {confirmRestore && (
        <ConfirmModal
          message={
            <>
              Restore <span className="font-semibold">{confirmRestore.bookTitle}</span>? This
              creates a new book from this backup — it won’t overwrite anything you have now.
            </>
          }
          confirmLabel="Restore as new book"
          busy={restoringId !== null}
          onConfirm={handleRestore}
          onCancel={() => setConfirmRestore(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          message={
            <>
              Delete this backup of <span className="font-semibold">{confirmDelete.bookTitle}</span>?
              This can’t be undone.
            </>
          }
          confirmLabel="Delete backup"
          busy={deletingId !== null}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
