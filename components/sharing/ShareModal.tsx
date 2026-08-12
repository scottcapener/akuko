"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Portal } from "@/components/ui/Portal";
import type { ShareState, ShareRecipient } from "@/lib/shared/types";

// Recipient management for one chapter (SHARED_WITH_YOU.md §3.5). Type an email
// and Send (or Enter/comma) to invite; each invite snapshots the chapter on the
// first share, grants access, and emails them. Recipients render with an Avatar
// + name (or the raw email while pending) and an × to revoke. Purely recipient
// management — the snapshot actions live in the mini-menu (§3.6).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  chapterId: string;
  initialState: ShareState;
  onClose: () => void;
  onStateChange: (state: ShareState) => void;
}

export function ShareModal({ chapterId, initialState, onClose, onStateChange }: Props) {
  const [recipients, setRecipients] = useState<ShareRecipient[]>(initialState.recipients);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid = EMAIL_RE.test(email.trim());

  function apply(state: ShareState) {
    setRecipients(state.recipients);
    onStateChange(state);
  }

  async function addRecipient() {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value) || busy) return;
    if (recipients.some((r) => r.email.toLowerCase() === value)) {
      setEmail("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, emails: [value] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add that person.");
      apply(data as ShareState);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRecipient(target: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/share/recipients?chapterId=${encodeURIComponent(chapterId)}&email=${encodeURIComponent(target)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't remove that person.");
      apply(data as ShareState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRecipient();
    }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-panel rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5">
            <div>
              <h2 className="text-text text-base font-bold">Share chapter</h2>
              <p className="text-subtle text-xs leading-relaxed mt-1 max-w-[22rem]">
                People you invite can read this chapter and leave comments. They see a copy as it is
                now — not your live edits.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-subtle/50 hover:text-subtle transition-colors flex-shrink-0 -mr-1"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Email input + Send */}
          <div className="px-5 pt-4">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="Invite with email address…"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                onKeyDown={onInputKeyDown}
                className="flex-1 min-w-0 bg-bg text-text text-sm px-3 py-2 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
              />
              <button
                onClick={addRecipient}
                disabled={!valid || busy}
                className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hi disabled:opacity-40 transition-colors flex-shrink-0"
              >
                Send
              </button>
            </div>
            {error && <p className="text-[11px] text-error mt-2">{error}</p>}
          </div>

          {/* Shared with */}
          <div className="px-5 pt-5 pb-2">
            <p className="text-label-m uppercase text-subtle mb-2">Shared with</p>
            {recipients.length === 0 ? (
              <p className="text-subtle/70 text-xs py-1">Not shared with anyone yet.</p>
            ) : (
              <div className="flex flex-col max-h-56 overflow-y-auto -mx-1">
                {recipients.map((r) => (
                  <div
                    key={r.email}
                    className="flex items-center gap-3 px-1 py-1.5 rounded-lg group"
                  >
                    <Avatar name={r.name} src={r.avatarUrl} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-text text-sm truncate">{r.name}</p>
                      {r.pending && <p className="text-subtle/60 text-[11px]">Pending</p>}
                    </div>
                    <button
                      onClick={() => removeRecipient(r.email)}
                      disabled={busy}
                      className="text-subtle hover:text-error text-xs px-2 py-1 rounded transition-colors flex-shrink-0 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-5 py-4 mt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-elevated text-text text-sm font-semibold hover:bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hi transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
