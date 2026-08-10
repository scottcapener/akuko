"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import NavPanel, { PanelToggleIcon } from "@/components/NavPanel";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { useColumnResize } from "@/lib/useColumnResize";

// The Workspace shell — the pages outside the writer (Books, Backups, Export,
// Settings, Account) share this frame: a persistent, resizable Nav Panel on
// desktop, a slide-in drawer on mobile. The writer (/write) is deliberately NOT
// in this group; it keeps its own chrome.

// Drag-resizable width (mirrors the Book panel); collapses to a rail.
const NAV_MIN = 240;
const NAV_MAX = 360;
const NAV_DEFAULT = 276;
const NAV_COLLAPSED = 56;
const COLLAPSE_MS = 200;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorageState("hc.navCollapsed", false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = useColumnResize("hc.navWidth", NAV_DEFAULT, NAV_MIN, NAV_MAX, 1);

  // The resize hook reads its stored width synchronously, but only on the client
  // — so the server renders the default and painting it would flash to the stored
  // width on load. Instead the desktop column isn't rendered until after mount
  // (like the writer waiting on `store.hydrated`): its first paint is already at
  // the remembered width, no default-to-stored adjustment. Mobile uses the drawer
  // and is unaffected.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="h-full flex bg-bg overflow-hidden">
      {/* ── Desktop Nav Panel ── */}
      {/* The column animates its width on collapse while the panel body fades
          (see NavPanel): the two run off the same boolean. The transition is
          dropped during a resize drag so the edge tracks the cursor. */}
      {mounted && (
        <>
          <div
            className="hidden md:flex flex-shrink-0 flex-col overflow-hidden"
            style={{
              width: collapsed ? NAV_COLLAPSED : nav.width,
              transition: nav.resizing ? "none" : `width ${COLLAPSE_MS}ms ease-in-out`,
            }}
          >
            <NavPanel
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
              expandedWidth={nav.width}
            />
          </div>
          {/* Resize handle — hidden while collapsed (nothing to resize). */}
          {!collapsed && (
            <div
              onMouseDown={nav.onMouseDown}
              className="hidden md:block relative z-10 w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60 before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']"
            />
          )}
        </>
      )}

      {/* ── Main area (both breakpoints) ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Mobile top bar — panel toggle opens the drawer; centred wordmark. */}
        <header className="md:hidden relative flex items-center px-4 py-3 border-b border-border-subtle flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-subtle hover:text-text transition-colors"
            aria-label="Open navigation"
          >
            <PanelToggleIcon className="w-6 h-6" />
          </button>
          <Image
            src="/logo-wordmark.svg"
            alt="Hot Cocoa"
            width={110}
            height={20}
            priority
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          />
        </header>

        {/* Page content — rendered once; scrolls independently of the nav. */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-scrim z-30" onClick={() => setMobileOpen(false)} />
      )}
      <div
        className={`md:hidden fixed inset-y-0 left-0 z-40 w-full transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <NavPanel onClose={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
      </div>
    </div>
  );
}
