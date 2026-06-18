"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  backdrop?: "dark" | "medium";
}

export function Modal({
  onClose,
  children,
  maxWidth = "max-w-lg",
  backdrop = "dark",
}: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const backdropClass = backdrop === "dark" ? "bg-black/85" : "bg-black/70";

  return createPortal(
    <div
      className={`fixed inset-0 ${backdropClass} z-50 flex items-center justify-center p-4`}
      onClick={onClose}
    >
      <div
        className={`relative bg-panel rounded-2xl w-full ${maxWidth} shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
