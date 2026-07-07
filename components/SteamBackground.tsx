"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient cozy background for the landing hero: a slow, warm rise of steam with
 * fine drifting sparks over a glow hinted just beyond the bottom edge. Rendered
 * on a transparent canvas that sits behind the hero content (pointer-events-none).
 *
 * Design decisions:
 * - The look is built for the dark palette (additive warm light on near-black).
 *   On the light theme it would read as muddy haze, so we simply don't animate
 *   there — the hero falls back to the plain page background.
 * - Honors prefers-reduced-motion by painting a single static glow, no loop.
 * - Pauses the RAF loop when scrolled out of view or the tab is hidden.
 *
 * Motion is currently pure buoyancy (the curl field is dialed off via HX/VY = 0),
 * but the field machinery is kept intact and gated so it can be re-enabled by
 * nudging HX/VY without other changes.
 */

// --- compact 3D simplex noise (Gustavson, public domain) — drives the ambient
// "draft" that makes the whole scene ebb and flow, and (when enabled) the curl field.
function makeNoise3D(seed: number) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed || 1;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const n = Math.floor(rng() * (i + 1));
    const q = p[i];
    p[i] = p[n];
    p[n] = q;
  }
  const perm = new Uint8Array(512);
  const pm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    pm[i] = perm[i] % 12;
  }
  const g = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0,
    -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);
  const F = 1 / 3;
  const G = 1 / 6;
  return (x: number, y: number, z: number) => {
    const sk = (x + y + z) * F;
    const i = Math.floor(x + sk);
    const j = Math.floor(y + sk);
    const k = Math.floor(z + sk);
    const t = (i + j + k) * G;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G, y1 = y0 - j1 + G, z1 = z0 - k1 + G;
    const x2 = x0 - i2 + 2 * G, y2 = y0 - j2 + 2 * G, z2 = z0 - k2 + 2 * G;
    const x3 = x0 - 1 + 3 * G, y3 = y0 - 1 + 3 * G, z3 = z0 - 1 + 3 * G;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0, tt, gi;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { gi = pm[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n0 = tt * tt * (g[gi] * x0 + g[gi + 1] * y0 + g[gi + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n1 = tt * tt * (g[gi] * x1 + g[gi + 1] * y1 + g[gi + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n2 = tt * tt * (g[gi] * x2 + g[gi + 1] * y2 + g[gi + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n3 = tt * tt * (g[gi] * x3 + g[gi + 1] * y3 + g[gi + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

// Tuned constants (see the iterated mockups). Curl field is off (HX/VY = 0).
const SP = 0.0015; // curl field spatial scale
const TP = 0.05; // curl field time scale
const EPS = 1.0; // finite-difference step for the curl
const HX = 0; // horizontal curl influence (0 = straight rise)
const VY = 0; // vertical curl influence
const USE_FIELD = HX !== 0 || VY !== 0;

type Steam = { x: number; y: number; age: number; life: number; r0: number; rise: number; force: number; a: number };
type Spark = { x: number; y: number; age: number; life: number; r: number; rise: number; force: number; a: number; tw: number; ph: number; toff: number };

export default function SteamBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // The effect is built for the dark palette; skip entirely on light theme.
    if (document.documentElement.dataset.theme === "light") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const noise = makeNoise3D(1337);

    let W = 0;
    let H = 0;
    let steam: Steam[] = [];
    let sparks: Spark[] = [];
    let t = 0;
    let flow = 0;
    let raf = 0;
    let running = false;

    const curl = (x: number, y: number, tt: number): [number, number] => {
      const n1 = noise(x * SP, (y + EPS) * SP, tt * TP);
      const n2 = noise(x * SP, (y - EPS) * SP, tt * TP);
      const n3 = noise((x + EPS) * SP, y * SP, tt * TP);
      const n4 = noise((x - EPS) * SP, y * SP, tt * TP);
      return [(n1 - n2) / (2 * EPS), -(n3 - n4) / (2 * EPS)];
    };

    // Full body through ~40% up the viewport, dissolved by ~72%.
    const hFade = (y: number) => {
      const hb = (H - y) / H;
      return hb < 0.4 ? 1 : Math.max(0, 1 - (hb - 0.4) / 0.32);
    };
    const hFadeSpark = (y: number) => {
      const hb = (H - y) / H;
      return hb < 0.6 ? 1 : Math.max(0, 1 - (hb - 0.6) / 0.22);
    };

    const spawnSteam = (p: Steam) => {
      p.x = W * (0.5 + (Math.random() - 0.5) * 0.94);
      p.y = H + rand(0, 50);
      p.age = 0;
      p.life = rand(1000, 1700);
      p.r0 = rand(16, 48);
      p.rise = rand(0.233, 0.692);
      p.force = rand(109, 160);
      p.a = rand(0.014, 0.026);
    };
    const spawnSpark = (s: Spark) => {
      s.x = W * (0.5 + (Math.random() - 0.5) * 0.98);
      s.y = H + rand(0, 40);
      s.age = 0;
      s.life = rand(900, 1500);
      s.r = rand(0.4, 1.1);
      s.rise = rand(0.364, 0.764);
      s.force = rand(101, 174);
      s.a = rand(0.3, 0.7);
      s.tw = rand(0.4, 1.0);
      s.ph = rand(0, 6.28);
      s.toff = rand(-360, 360);
    };

    // Keep per-pixel density roughly constant across viewport sizes.
    const seed = () => {
      const REF = 680 * 560;
      const scale = Math.min(2.2, Math.max(0.6, (W * H) / REF));
      const steamN = Math.round(300 * scale);
      const sparkN = Math.round(85 * scale);
      steam = [];
      sparks = [];
      for (let i = 0; i < steamN; i++) {
        const p = {} as Steam;
        spawnSteam(p);
        p.age = rand(0, p.life);
        steam.push(p);
      }
      for (let j = 0; j < sparkN; j++) {
        const s = {} as Spark;
        spawnSpark(s);
        s.age = rand(0, s.life);
        sparks.push(s);
      }
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

    const paintGlow = (bnorm: number) => {
      const pulse = 0.8 + 0.2 * bnorm;
      const glow = ctx.createRadialGradient(W * 0.5, H + 70, 0, W * 0.5, H + 70, H * 0.9);
      glow.addColorStop(0, `rgba(139,109,90,${0.44 * pulse})`);
      glow.addColorStop(0.35, `rgba(117,92,75,${0.2 * pulse})`);
      glow.addColorStop(0.7, `rgba(117,92,75,${0.05 * pulse})`);
      glow.addColorStop(1, "rgba(117,92,75,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    };

    const frame = () => {
      if (!running) return;
      t += 1;

      // Ambient wandering draft: a slow noise channel that swells and subsides.
      const braw = noise(1000.5, t * 0.0011, 5.5);
      const brip = noise(2000.5, t * 0.0034, 9.1);
      const bnorm = (braw * 0.78 + brip * 0.22 + 1) / 2;
      const breath = 0.3 + bnorm * 1.05;
      flow += breath * 0.6552;

      ctx.clearRect(0, 0, W, H);
      paintGlow(bnorm);

      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < steam.length; i++) {
        const p = steam[i];
        if (USE_FIELD) {
          const v = curl(p.x, p.y, flow);
          p.x += v[0] * p.force * HX * breath;
          p.y += (v[1] * p.force * VY - p.rise) * breath;
        } else {
          p.y += -p.rise * breath;
        }
        p.age++;
        if (p.age > p.life || p.y < -70) {
          spawnSteam(p);
          continue;
        }
        const lf = p.age / p.life;
        const env = Math.sin(Math.min(lf, 1) * Math.PI);
        const a = p.a * env * hFade(p.y);
        if (a <= 0.002) continue;
        const r = p.r0 + p.age * 0.03;
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, `rgba(178,148,126,${a})`);
        gr.addColorStop(0.55, `rgba(139,109,90,${a * 0.4})`);
        gr.addColorStop(1, "rgba(139,109,90,0)");
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 6.2832);
        ctx.fill();
      }

      for (let k = 0; k < sparks.length; k++) {
        const s = sparks[k];
        if (USE_FIELD) {
          const w = curl(s.x, s.y, flow + s.toff);
          s.x += w[0] * s.force * HX * breath + (Math.random() - 0.5) * 0.13;
          s.y += (w[1] * s.force * VY - s.rise) * breath + (Math.random() - 0.5) * 0.13;
        } else {
          s.x += (Math.random() - 0.5) * 0.13;
          s.y += -s.rise * breath + (Math.random() - 0.5) * 0.13;
        }
        s.age++;
        if (s.age > s.life || s.y < -30) {
          spawnSpark(s);
          continue;
        }
        const slf = s.age / s.life;
        const senv = Math.sin(Math.min(slf, 1) * Math.PI);
        const tw = 0.5 + 0.5 * Math.sin(t * 0.03 * s.tw + s.ph);
        const sa = s.a * senv * hFadeSpark(s.y) * tw;
        if (sa <= 0.01) continue;
        const halo = s.r * 2.4;
        const g2 = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, halo);
        g2.addColorStop(0, `rgba(228,203,174,${sa})`);
        g2.addColorStop(0.5, `rgba(214,180,150,${sa * 0.5})`);
        g2.addColorStop(1, "rgba(214,180,150,0)");
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, halo, 0, 6.2832);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    measure();
    seed();

    // Reduced motion: paint a single calm glow and don't animate.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      ctx.clearRect(0, 0, W, H);
      paintGlow(0.5);
      return () => {};
    }

    const ro = new ResizeObserver(() => {
      measure();
      seed();
    });
    ro.observe(canvas);

    // Only run while the hero is actually on screen.
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
