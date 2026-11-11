"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import type { LibraryImage } from "@/lib/types";

// Library image gallery: a 3-column masonry (equal widths, heights follow each
// image's own proportions) with live drag-reorder preview.
//
// Every cell is absolutely positioned from a computed layout, in one flat list
// with stable keys. That keeps the <img> elements mounted while they move (a
// column-per-div layout would remount them on every column change and make them
// blink) and lets a CSS transition animate the shuffle.

const COLS = 3;
// Thumbnail shape limits (width / height): never wider than 3:2 or taller than
// 1:2. Images outside the range are cropped (object-cover) to fit.
const MIN_RATIO = 1 / 2;
const MAX_RATIO = 3 / 2;
const GAP = 6; // px, matches Tailwind gap-1.5
// How long the pointer must rest over a different image before the order
// previews a move, and how long to hold still after one so the shuffle can
// settle. Prevents rapid temporary reordering while sweeping across cells.
const DWELL_MS = 160;
const SETTLE_MS = 280;

type Item =
  | { kind: "image"; id: string; ratio: number }
  | { kind: "pending"; id: string }
  | { kind: "add"; id: string };

interface Placed {
  item: Item;
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeLayout(items: Item[], width: number) {
  const colW = Math.max(0, (width - GAP * (COLS - 1)) / COLS);
  const heights = new Array(COLS).fill(0);
  const placed: Placed[] = [];
  for (const item of items) {
    let c = 0;
    for (let i = 1; i < COLS; i++) if (heights[i] < heights[c] - 0.5) c = i;
    const ratio = item.kind === "image" ? item.ratio : 1;
    const h = colW / ratio;
    placed.push({ item, x: c * (colW + GAP), y: heights[c], w: colW, h });
    heights[c] += h + GAP;
  }
  return { placed, height: Math.max(0, Math.max(...heights) - GAP) };
}

function moveId(order: string[], id: string, toIndex: number) {
  const from = order.indexOf(id);
  if (from === -1 || from === toIndex) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(toIndex, 0, id);
  return next;
}

export function ImageMasonry({
  images,
  pending,
  onOpen,
  onRemove,
  onReorder,
  onRefresh,
  onMeasured,
  onAdd,
}: {
  images: LibraryImage[];
  pending: number;
  onOpen: (index: number) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onRefresh: (id: string) => void;
  onMeasured?: (id: string, width: number, height: number) => void;
  onAdd: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Ratios learned from loaded thumbnails; covers images with no stored size.
  const [learned, setLearned] = useState<Record<string, number>>({});
  const retried = useRef<Set<string>>(new Set());
  const reported = useRef<Set<string>>(new Set());

  // Drag-reorder preview state.
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTarget = useRef<string | null>(null);
  const lockedUntil = useRef(0);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Don't animate the very first placement.
  useEffect(() => {
    if (width > 0) setAnimate(true);
  }, [width]);

  const clearDwell = useCallback(() => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
    hoverTarget.current = null;
  }, []);
  useEffect(() => clearDwell, [clearDwell]);

  const byId = new Map(images.map((i) => [i.id, i]));
  const baseOrder = images.map((i) => i.id);
  // Drop stale ids / append new ones if the list changed mid-drag.
  const order = preview
    ? [...preview.filter((id) => byId.has(id)), ...baseOrder.filter((id) => !preview.includes(id))]
    : baseOrder;

  const ratioOf = (img: LibraryImage) => {
    const natural = img.width && img.height ? img.width / img.height : learned[img.id] ?? 1;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural));
  };

  const items: Item[] = [
    ...order.map((id): Item => ({ kind: "image", id, ratio: ratioOf(byId.get(id)!) })),
    ...Array.from({ length: pending }, (_, i): Item => ({ kind: "pending", id: `pending-${i}` })),
    { kind: "add", id: "add" },
  ];
  const { placed, height } = computeLayout(items, width);

  function resetDrag() {
    clearDwell();
    setDragId(null);
    setPreview(null);
  }

  function handleDragOver(e: React.DragEvent) {
    if (dragId === null) return;
    e.preventDefault(); // makes the whole gallery a valid drop zone
    e.dataTransfer.dropEffect = "move";
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const hit = placed.find(
      (p) =>
        p.item.kind === "image" && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h
    );
    const target = hit && hit.item.id !== dragId ? hit.item.id : null;

    if (target === hoverTarget.current) return;
    clearDwell();
    if (!target) return;
    hoverTarget.current = target;
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null;
      hoverTarget.current = null;
      if (Date.now() < lockedUntil.current) return;
      setPreview((cur) => {
        const base = cur ?? baseOrder;
        const to = base.indexOf(target);
        return to === -1 ? cur : moveId(base, dragId, to);
      });
      lockedUntil.current = Date.now() + SETTLE_MS;
    }, DWELL_MS);
  }

  function handleDrop(e: React.DragEvent) {
    if (dragId === null) return; // an external file drop — let it bubble
    e.preventDefault();
    e.stopPropagation();
    const from = baseOrder.indexOf(dragId);
    const to = preview ? order.indexOf(dragId) : from;
    resetDrag();
    if (from !== -1 && to !== -1 && from !== to) onReorder(from, to);
  }

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      style={{ height }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {width > 0 &&
        placed.map(({ item, x, y, w, h }) => {
          const style: React.CSSProperties = {
            position: "absolute",
            top: 0,
            left: 0,
            width: w,
            height: h,
            transform: `translate(${x}px, ${y}px)`,
            transition: animate ? "transform 220ms ease, width 220ms ease, height 220ms ease" : "none",
          };
          if (item.kind === "pending") {
            return (
              <div key={item.id} style={style} className="rounded bg-panel animate-pulse" aria-label="Uploading image" />
            );
          }
          if (item.kind === "add") {
            return (
              <button
                key={item.id}
                style={style}
                className="rounded bg-panel flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
                onClick={onAdd}
              >
                <Image src="/plus.svg" alt="Add image" width={14} height={14} />
              </button>
            );
          }
          const img = byId.get(item.id)!;
          return (
            <GalleryImage
              key={item.id}
              img={img}
              style={style}
              dragging={dragId === item.id}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", img.id);
                setPreview(null);
                lockedUntil.current = 0;
                // Hide the slot only after the browser has snapshotted the drag
                // ghost; React flushes discrete events synchronously, so setting
                // this inline would blank the ghost too.
                setTimeout(() => setDragId(img.id), 0);
              }}
              onDragEnd={resetDrag}
              onOpen={() => onOpen(baseOrder.indexOf(img.id))}
              onRemove={() => onRemove(img.id)}
              onLoad={(el) => {
                retried.current.delete(img.id);
                const nw = el.naturalWidth;
                const nh = el.naturalHeight;
                if (!nw || !nh) return;
                setLearned((cur) =>
                  Math.abs((cur[img.id] ?? 0) - nw / nh) < 0.001 ? cur : { ...cur, [img.id]: nw / nh }
                );
                if (!(img.width && img.height) && !reported.current.has(img.id)) {
                  reported.current.add(img.id);
                  onMeasured?.(img.id, nw, nh);
                }
              }}
              onError={() => {
                if (!img.path || retried.current.has(img.id)) return;
                retried.current.add(img.id);
                onRefresh(img.id);
              }}
            />
          );
        })}
    </div>
  );
}

function GalleryImage({
  img,
  style,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onRemove,
  onLoad,
  onError,
}: {
  img: LibraryImage;
  style: React.CSSProperties;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onLoad: (el: HTMLImageElement) => void;
  onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const prevSrc = useRef(img.dataUrl);
  if (prevSrc.current !== img.dataUrl) {
    prevSrc.current = img.dataUrl;
    setLoaded(false);
  }

  return (
    <div
      style={style}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // While dragged, the cell stays in the layout as blank space (the browser's
      // own drag ghost follows the cursor); no dimmed duplicate in the slot.
      className={`group rounded ${loaded ? "" : "bg-panel animate-pulse"} ${dragging ? "opacity-0" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.dataUrl}
        alt={img.name}
        className={`w-full h-full object-cover rounded cursor-pointer transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onClick={onOpen}
        draggable={false}
        onLoad={(e) => {
          setLoaded(true);
          onLoad(e.currentTarget);
        }}
        onError={onError}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex"
      >
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
