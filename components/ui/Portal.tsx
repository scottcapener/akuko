"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Renders children into document.body so fixed overlays escape transformed
// ancestors (the editor columns use CSS transforms). Mirrors the local Portal
// in RightColumn; extracted so the sharing modals can reuse it.
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
