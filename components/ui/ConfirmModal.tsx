"use client";

import type React from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

// A small destructive-confirmation modal, shared across surfaces (chapter/section
// delete). `extra` slots content between the message and the buttons — e.g. the
// "also stop sharing" checkbox on the delete-chapter flow (§7 / Stage 8).
export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  extra,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm text-text leading-relaxed">{message}</p>
        {extra}
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-900/40 text-error text-xs font-semibold hover:bg-red-900/60 transition-colors"
          >
            {confirmLabel}
          </button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
