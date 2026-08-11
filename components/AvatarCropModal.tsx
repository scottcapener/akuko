"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";

// Circular avatar cropper. The user pans/zooms a picked image inside a fixed
// round viewport; on confirm we render the framed region to a square canvas and
// hand back a small JPEG. The circle is only the display frame — we export the
// square bounding box (the Avatar component masks it round everywhere), which is
// how avatars are conventionally stored.

const VIEW = 288;        // circular viewport diameter, px
const OUTPUT = 512;      // exported square edge, px
const MAX_ZOOM = 4;      // relative to the "cover" baseline (zoom = 1)

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

interface Props {
  imageUrl: string;   // object URL of the picked file
  fileName: string;   // original name, for the exported file
  busy?: boolean;     // parent is uploading the result
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

export default function AvatarCropModal({
  imageUrl,
  fileName,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // image-center vs viewport-center, px
  const [exporting, setExporting] = useState(false);

  // Live mirrors of zoom/offset so a multi-touch gesture reads the current value
  // mid-stream (React state can lag within a burst of pointer events).
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(offset);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  // Load the image to learn its natural dimensions.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Baseline scale that makes the shorter edge exactly cover the circle, then
  // the user's zoom on top. Displayed image size in viewport px.
  const s0 = natural ? VIEW / Math.min(natural.w, natural.h) : 1;
  const s = s0 * zoom;
  const dispW = natural ? natural.w * s : VIEW;
  const dispH = natural ? natural.h * s : VIEW;
  const maxX = Math.max(0, (dispW - VIEW) / 2);
  const maxY = Math.max(0, (dispH - VIEW) / 2);

  const clampOffset = useCallback(
    (o: { x: number; y: number }) => ({ x: clamp(o.x, -maxX, maxX), y: clamp(o.y, -maxY, maxY) }),
    [maxX, maxY]
  );

  // Re-clamp whenever zoom (and thus the bounds) change.
  useEffect(() => {
    setOffset((o) => clampOffset(o));
  }, [clampOffset]);

  // Clamp an offset against the bounds for an arbitrary zoom — needed mid-pinch,
  // where the zoom being applied isn't yet the committed `zoom` state.
  const clampAt = useCallback(
    (o: { x: number; y: number }, z: number) => {
      const sc = s0 * z;
      const mx = natural ? Math.max(0, (natural.w * sc - VIEW) / 2) : 0;
      const my = natural ? Math.max(0, (natural.h * sc - VIEW) / 2) : 0;
      return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) };
    },
    [natural, s0]
  );

  // ── Pointer gestures: one finger pans, two fingers pinch-zoom ──
  type Pt = { x: number; y: number };
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<
    | { kind: "pan"; px: number; py: number; ox: number; oy: number }
    | { kind: "pinch"; dist: number; zoom: number; mx: number; my: number; ox: number; oy: number }
    | null
  >(null);

  const activePoints = () => [...pointers.current.values()];
  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function beginPan() {
    const [p] = activePoints();
    gesture.current = { kind: "pan", px: p.x, py: p.y, ox: offsetRef.current.x, oy: offsetRef.current.y };
  }
  function beginPinch() {
    const [a, b] = activePoints();
    const m = midpoint(a, b);
    gesture.current = {
      kind: "pinch",
      dist: distance(a, b),
      zoom: zoomRef.current,
      mx: m.x,
      my: m.y,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    // Guarded: capture can throw InvalidPointerId for a non-live pointer.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) beginPinch();
    else beginPan();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = activePoints();
      const nextZoom = clamp((g.zoom * distance(a, b)) / g.dist, 1, MAX_ZOOM);
      const m = midpoint(a, b);
      setZoom(nextZoom);
      // Pan by how far the two-finger midpoint has travelled, so the image
      // tracks the fingers while it scales.
      setOffset(clampAt({ x: g.ox + (m.x - g.mx), y: g.oy + (m.y - g.my) }, nextZoom));
    } else if (g.kind === "pan") {
      setOffset(clampAt({ x: g.ox + (e.clientX - g.px), y: g.oy + (e.clientY - g.py) }, zoomRef.current));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    // Resume a clean pan when a pinch drops to one finger; end when none remain.
    if (pointers.current.size === 1) beginPan();
    else if (pointers.current.size === 0) gesture.current = null;
  }

  // Wheel to zoom — native non-passive listener so we can preventDefault the
  // page scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * (1 - e.deltaY * 0.0015), 1, MAX_ZOOM));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Export the framed region ──────────────────────────────────
  function handleConfirm() {
    const img = imgRef.current;
    if (!img || !natural) return;
    setExporting(true);

    // Source rect (in the image's own pixels) currently shown in the square
    // that bounds the circle. left/top are the image's position in viewport px.
    const left = VIEW / 2 - dispW / 2 + offset.x;
    const top = VIEW / 2 - dispH / 2 + offset.y;
    const srcX = -left / s;
    const srcY = -top / s;
    const srcSize = VIEW / s;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setExporting(false); return; }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);

    canvas.toBlob(
      (blob) => {
        setExporting(false);
        if (!blob) return;
        const base = fileName.replace(/\.[^.]+$/, "") || "avatar";
        onConfirm(new File([blob], `${base}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9
    );
  }

  const working = exporting || busy;

  return (
    <Modal onClose={working ? () => {} : onCancel} maxWidth="max-w-md">
      <div className="p-6 flex flex-col items-center gap-5">
        <div className="w-full text-center">
          <h2 className="text-text text-base font-semibold">Position your photo</h2>
          <p className="mt-1 text-xs text-subtle">Drag to reposition · scroll or slide to zoom</p>
        </div>

        {/* Circular viewport */}
        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative rounded-full overflow-hidden bg-elevated touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
        >
          {natural && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute max-w-none pointer-events-none"
              style={{
                width: dispW,
                height: dispH,
                left: VIEW / 2 - dispW / 2 + offset.x,
                top: VIEW / 2 - dispH / 2 + offset.y,
              }}
            />
          )}
          {/* Subtle ring to reinforce the crop edge */}
          <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/15 pointer-events-none" />
        </div>

        {/* Zoom slider */}
        <div className="w-full flex items-center gap-3 px-2">
          <span className="text-subtle text-sm select-none" aria-hidden>−</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="flex-1"
            style={{ accentColor: "var(--color-accent)" }}
          />
          <span className="text-subtle text-base select-none" aria-hidden>+</span>
        </div>

        {/* Actions */}
        <div className="w-full flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={working}
            className="px-4 py-2 rounded-lg text-xs text-subtle hover:text-text disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={working}
            className="px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:bg-accent-hi disabled:opacity-50 transition-colors"
          >
            {working ? "Saving…" : "Set photo"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
