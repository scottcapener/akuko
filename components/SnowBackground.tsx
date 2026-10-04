"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient background for the landing hero: ~200 soft circular snowflakes falling
 * over a near-black field, pushed around by a slow, shifting breeze. Painted on
 * its own opaque canvas that sits behind the hero content (pointer-events-none).
 *
 * - Flakes glow brighter toward the horizontal center of the screen, with a random per-flake offset.
 * - Every flake has its own size, opacity, opacity, fall speed, sway phase
 *   and wind sensitivity, so no two move alike.
 * - Wind is a global gust (layered slow sines) that flakes follow with inertia,
 *   plus each flake's own sway and flutter. Small flakes are pushed harder.
 * - Honors prefers-reduced-motion with a single static frame, and pauses the
 *   RAF loop when scrolled out of view or the tab is hidden.
 */

// --- Tunables -------------------------------------------------------------
export const SNOW = {
  count: 200, // flakes on screen at once
  background: "#100F0F",
  flakeColor: "#8B6D5A", // brightest a flake can be
  sizeMin: 1, // px (diameter)
  sizeMax: 5, // px (diameter)
  sizeBias: 1.8, // >1 skews toward small flakes, 1 = uniform
  opacityMin: 0.5, // per-flake alpha range
  opacityMax: 1,
  edgeBrightness: 0.1, // mix between background (0) and flakeColor (1) at the left/right screen edge
  centerBrightness: 1, // ...and at the horizontal center
  centerFalloff: 1.3, // >1 keeps the glow tighter around the middle, <1 spreads it out
  brightnessRandomness: 0.55, // per-flake random offset on that mix (0 = purely positional)
  fallMin: 14, // px/s, fall speed of the smallest flake
  fallMax: 38, // px/s, fall speed of the largest flake
  windStrength: 26, // px/s, peak of the global gust
  windPeriod: 22, // seconds, rough length of one gust cycle
  windSensitivity: 1.6, // how much more small flakes are pushed than large (0 = equal)
  swayAmp: 9, // px/s, per-flake side-to-side drift
  swayFreqMin: 0.15, // Hz
  swayFreqMax: 0.5, // Hz
  flutter: 4, // px/s, quick per-flake jitter in fall speed
  inertia: 1.4, // 1/s, how quickly a flake catches up to the wind (lower = floatier)
} as const;
// --------------------------------------------------------------------------

type Flake = {
  x: number;
  y: number;
  vx: number;
  size: number;
  alpha: number;
  rand: number; // fixed per-flake random in [-0.5, 0.5], offsets positional brightness
  fall: number;
  sens: number;
  swayPhase: number;
  swayFreq: number;
  swayAmp: number;
  flutterPhase: number;
  flutterFreq: number;
  windPhase: number;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export default function SnowBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const bg = hexToRgb(SNOW.background);
    const fg = hexToRgb(SNOW.flakeColor);

    let W = 0;
    let H = 0;
    let flakes: Flake[] = [];
    let t = 0;
    let last = 0;
    let raf = 0;
    let running = false;

    const makeFlake = (scatter: boolean): Flake => {
      const u = Math.pow(Math.random(), SNOW.sizeBias);
      const size = SNOW.sizeMin + u * (SNOW.sizeMax - SNOW.sizeMin);
      return {
        x: rand(0, W),
        y: scatter ? rand(0, H) : -size * 2 - rand(0, 40),
        vx: 0,
        size,
        alpha: rand(SNOW.opacityMin, SNOW.opacityMax),
        rand: Math.random() - 0.5,
        fall: SNOW.fallMin + (size - SNOW.sizeMin) / (SNOW.sizeMax - SNOW.sizeMin) * (SNOW.fallMax - SNOW.fallMin) + rand(-3, 3),
        // small flakes (size ≈ min) get sens ≈ 1 + windSensitivity, large ≈ 1
        sens: 1 + SNOW.windSensitivity * (1 - (size - SNOW.sizeMin) / (SNOW.sizeMax - SNOW.sizeMin)),
        swayPhase: rand(0, 6.2832),
        swayFreq: rand(SNOW.swayFreqMin, SNOW.swayFreqMax),
        swayAmp: SNOW.swayAmp * rand(0.5, 1.2),
        flutterPhase: rand(0, 6.2832),
        flutterFreq: rand(0.6, 1.6),
        windPhase: rand(-0.6, 0.6), // slight lag so gusts roll through the field
      };
    };

    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      flakes = Array.from({ length: SNOW.count }, () => makeFlake(true));
    };

    // Global breeze in [-1, 1]: three incommensurate slow sines, so it never repeats obviously.
    const gust = (time: number, phase: number) => {
      const w = (2 * Math.PI) / SNOW.windPeriod;
      const s = time + phase * 4;
      return (
        0.55 * Math.sin(s * w) +
        0.3 * Math.sin(s * w * 2.31 + 1.7) +
        0.15 * Math.sin(s * w * 4.77 + 4.1)
      );
    };

    const paint = () => {
      ctx.fillStyle = SNOW.background;
      ctx.fillRect(0, 0, W, H);
      const cx = W / 2;
      for (const f of flakes) {
        // Brighter toward the horizontal middle of the screen (vertical position ignored),
        // nudged by the flake's own random.
        const d = Math.min(1, Math.abs(f.x - cx) / cx);
        const pos = SNOW.edgeBrightness + (SNOW.centerBrightness - SNOW.edgeBrightness) * Math.pow(1 - d, SNOW.centerFalloff);
        const mix = Math.max(0, Math.min(1, pos + f.rand * SNOW.brightnessRandomness));
        const r = Math.round(bg[0] + (fg[0] - bg[0]) * mix);
        const g = Math.round(bg[1] + (fg[1] - bg[1]) * mix);
        const b = Math.round(bg[2] + (fg[2] - bg[2]) * mix);
        ctx.fillStyle = `rgba(${r},${g},${b},${f.alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size / 2, 0, 6.2832);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        const wind = gust(t, f.windPhase) * SNOW.windStrength * f.sens;
        const sway = Math.sin(t * f.swayFreq * 6.2832 + f.swayPhase) * f.swayAmp;
        // Velocity eases toward the local wind rather than snapping to it.
        f.vx += (wind + sway - f.vx) * Math.min(1, SNOW.inertia * dt);
        f.x += f.vx * dt;
        f.y += (f.fall + Math.sin(t * f.flutterFreq * 6.2832 + f.flutterPhase) * SNOW.flutter) * dt;

        // Wrap sideways; recycle at the bottom with a fresh random flake.
        const m = f.size + 2;
        if (f.x < -m) f.x = W + m;
        else if (f.x > W + m) f.x = -m;
        if (f.y > H + m) flakes[i] = makeFlake(false);
      }

      paint();
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    measure();
    seed();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint();
      return () => {};
    }

    const ro = new ResizeObserver(() => {
      measure();
      seed();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !document.hidden) start();
        else stop();
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
