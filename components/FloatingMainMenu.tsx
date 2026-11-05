"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// The desktop writer's Main Menu: a floating card centered over the menu icon in
// the Book panel's footer, with the icon replaced by an X on its own floating
// circle. The card's bottom sits a fixed gap above the circle; its top keeps a
// fixed gap from the page top. The content region scrolls when the viewport is
// too short; the footer (Give feedback) never scrolls.

const MENU_W = 276;
const CIRCLE = 44;
const GAP_ABOVE_CIRCLE = 22;
const TOP_GAP = 24;
const EDGE = 8;
const MS = 200;

type Anchor = { cx: number; cy: number; vw: number; vh: number };

export function FloatingMainMenu({
  open,
  onClose,
  anchorRef,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  footer: ReactNode;
}) {
  // `present` keeps the layer mounted through the close animation; `shown` drives
  // the animated state (opacity + slide up from the circle).
  const [present, setPresent] = useState(false);
  const [shown, setShown] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const measure = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
  };

  useLayoutEffect(() => {
    if (open) {
      measure();
      setPresent(true);
      // Two frames so the initial (hidden) styles paint before transitioning.
      let id2 = 0;
      const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
    }
    setShown(false);
    const t = setTimeout(() => setPresent(false), MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!present) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  if (!present || !anchor) return null;

  const circleTop = anchor.cy - CIRCLE / 2;
  const menuBottom = anchor.vh - (circleTop - GAP_ABOVE_CIRCLE);
  const left = Math.max(EDGE, Math.min(anchor.cx - MENU_W / 2, anchor.vw - MENU_W - EDGE));

  return createPortal(
    <>
      {/* Backdrop — dims the page; a press anywhere outside the menu closes it. */}
      <div
        className="fixed inset-0 z-40 bg-scrim-menu"
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${MS}ms ease-out` }}
        onMouseDown={onClose}
        aria-hidden
      />

      <div
        role="menu"
        className="fixed z-50 flex flex-col overflow-hidden rounded-[28px] border border-hover bg-panel shadow-2xl"
        style={{
          width: MENU_W,
          left,
          bottom: menuBottom,
          maxHeight: anchor.vh - menuBottom - TOP_GAP,
          opacity: shown ? 1 : 0,
          // Starts with its bottom at the top of the X circle, then rises into place.
          transform: `translateY(${shown ? 0 : GAP_ABOVE_CIRCLE}px)`,
          transition: `opacity ${MS}ms ease-out, transform ${MS}ms cubic-bezier(0,0,0.2,1)`,
          pointerEvents: shown ? undefined : "none",
        }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden hc-scroll-hoverbar pl-5 pr-[10px] py-4 flex flex-col gap-1 [&_a:hover]:bg-elevated [&_[role=switch]:hover]:bg-elevated">
          {children}
        </div>
        <div className="flex-shrink-0 border-t border-hover px-8 py-4">{footer}</div>
      </div>

      {/* The X — sits exactly over the menu icon it replaces. */}
      <button
        onClick={onClose}
        title="Close main menu"
        aria-label="Close main menu"
        className="fixed z-50 flex cursor-pointer items-center justify-center rounded-full border border-hover bg-panel text-subtle hover:text-text transition-colors"
        style={{ left: anchor.cx - CIRCLE / 2, top: circleTop, width: CIRCLE, height: CIRCLE }}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>,
    document.body
  );
}
