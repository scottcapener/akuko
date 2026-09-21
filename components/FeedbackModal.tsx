"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";

// Give Feedback flow, opened from the writer's Main Menu (LeftColumn). Two
// stages in one modal: the form (message + author identity + Send), then a
// thank-you card once it's delivered. Send posts only the message to
// /api/feedback — the server resolves the author's name + email from the session
// and emails it to the internal inbox (lib/email/feedbackEmail.ts), so the
// identity can't be spoofed from the client.

interface Props {
  authorName: string;
  authorAvatarUrl?: string | null;
  onClose: () => void;
}

// Shared close button — the × in the top-right, matching our other modals.
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      className="text-subtle/50 hover:text-subtle transition-colors flex-shrink-0 -mr-1"
      aria-label="Close"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

export function FeedbackModal({ authorName, authorAvatarUrl, onClose }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const canSend = message.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't send feedback. Please try again.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send feedback. Please try again.");
    } finally {
      setSending(false);
    }
  }

  // ── Thank-you card ──────────────────────────────────────────────────────────
  if (sent) {
    return (
      <Modal onClose={onClose} maxWidth="max-w-md" backdrop="dark">
        <div className="p-5">
          <div className="flex items-start justify-between">
            <h2 className="text-text text-base font-bold">Thank you 🔥</h2>
            <CloseButton onClose={onClose} />
          </div>
          <p className="text-subtle text-sm leading-relaxed mt-3">
            I want Hot Cocoa to feel like <em>home</em>, and I can’t do that without feedback from
            authors just like you. I’ll reach out if I have any further questions or updates about
            this. Stay awesome!
          </p>
          <p className="text-subtle text-xs mt-4">~ Scott, chief mixologist</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/scott-signature.svg"
            alt="Scott's signature"
            width={170}
            height={37}
            className="mt-2"
          />
        </div>
      </Modal>
    );
  }

  // ── Feedback form ───────────────────────────────────────────────────────────
  return (
    <Modal onClose={onClose} maxWidth="max-w-md" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-text text-base font-bold">Give feedback</h2>
            <p className="text-subtle text-xs leading-relaxed mt-1 max-w-[24rem]">
              Hot Cocoa is in an early state. We love to hear what’s working or not working!
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <textarea
          autoFocus
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setError("");
          }}
          placeholder="How can we make Hot Cocoa better for you?"
          rows={5}
          className="w-full resize-none bg-bg text-text text-sm px-3 py-2.5 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
        />

        {error && <p className="text-[11px] text-error -mt-2">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          {/* Author identity — the name/avatar the feedback is sent under (matches
              a comment's author line). Email is resolved server-side on Send. */}
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={authorName} src={authorAvatarUrl} size={28} />
            <span className="text-text text-sm font-medium truncate">{authorName}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-panel border border-border-subtle text-text text-sm font-medium hover:border-accent/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={!canSend}
              className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hi disabled:opacity-40 transition-colors"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
