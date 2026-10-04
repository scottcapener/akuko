# Snow background: performance guide

Applies to `components/SnowBackground.tsx` (the landing-page hero). The one number that matters is `SNOW.count`, currently **200**.

## How the cost is shaped

- **Per flake, per frame:** a few trig calls, one color string, one `arc` + `fill` on a 2D canvas. There is no per-flake allocation after setup (a flake is only re-made when it leaves the bottom).
- **Cost scales linearly with `count`.** Doubling flakes roughly doubles the per-frame work.
- **Canvas size is a second multiplier.** The canvas is cleared and refilled every frame, and its backing store is `viewport × devicePixelRatio` (capped at 2). A phone at DPR 2–3 is capped to 2; a 4K display at DPR 2 is the worst case. Flakes are tiny, so the full-canvas clear/composite usually costs more than the flakes themselves at low counts.
- **The frame image on top** is a static layer. It adds a one-time decode and some compositing, not per-frame JS.

## Measured (one data point)

Micro-benchmark of the draw loop in Chrome on the dev Mac (1440×900 canvas, DPR 2), averaged over 300 frames. This is **JS/command-recording time per frame only**; GPU raster and compositing happen after and aren't included, so treat it as a lower bound.

| Flakes | ms/frame (JS) | Share of a 16.7 ms (60 fps) budget |
|---|---|---|
| 100 | 0.09 | ~0.5% |
| **200** | **0.13** | **~1%** |
| 500 | 0.30 | ~2% |
| 1,000 | 0.62 | ~4% |
| 2,000 | 1.18 | ~7% |
| 5,000 | 3.33 | ~20% |

## What to expect across devices

These are estimates, not measurements. Phone and low-end numbers are extrapolated from typical single-thread speed ratios (a mid-range phone is commonly 3–6× slower than a recent laptop).

| Device class | Comfortable | Getting risky | Notes |
|---|---|---|---|
| Recent laptop / desktop | up to ~2,000 | 5,000+ | Plenty of headroom; 200 is negligible |
| Recent iPhone / flagship Android | ~1,000 | 2,000+ | 200 is effectively free |
| Mid-range phone, older tablet | ~400–600 | 1,000+ | 200 is safe |
| Low-end / old Android, battery saver | ~200–300 | 500+ | 200 is near the comfortable edge; watch battery |

Battery matters more than fps here: a looping canvas keeps the GPU and CPU awake. Even when frame time is tiny, an always-running animation costs power on phones.

## Already mitigated in the component

- Pauses when the hero scrolls out of view (`IntersectionObserver`) or the tab is hidden.
- Honors `prefers-reduced-motion` (one static frame, no loop).
- DPR capped at 2.
- Delta-time motion, with `dt` clamped to 50 ms, so a slow frame doesn't make flakes jump or the simulation spiral.

## If it ever needs to be cheaper

In rough order of payoff vs. effort:

1. **Scale count to device.** e.g. `count = round(200 * min(1, area / 1,000,000))`, or halve it when `navigator.hardwareConcurrency <= 4` or `matchMedia("(max-width: 640px)")`.
2. **Lower the DPR cap to 1–1.5.** The flakes are 1–5 px soft dots, so the resolution loss is nearly invisible; the fill cost drops by up to 4×.
3. **Cap the frame rate at 30 fps** on low-power devices (skip every other RAF). Motion is slow, so it reads fine.
4. **Batch by color.** Quantize brightness to ~8 levels and draw each level in one path (`beginPath`, many `arc`s, one `fill`). This cuts per-flake `fill` calls and color-string builds; it only matters at 1,000+ flakes.
5. **Pre-render sprites.** Draw each size × brightness bucket once to an offscreen canvas and `drawImage` it. Fastest for very high counts, but it needs the brightness (which changes with horizontal position) bucketed.
6. **Only repaint the dirty region** or move the loop to an `OffscreenCanvas` in a worker. Heavy lifts; not worth it at this scale.

## How to measure on a real device

- Chrome DevTools, Performance panel, record ~5 s of the home page, and check frame times and the "Main" thread. For phones, use remote debugging (Android) or Safari Web Inspector (iOS).
- Enable CPU throttling (4× or 6×) in DevTools as a quick stand-in for a mid/low-end phone.
- Watch for frames over 16.7 ms and for any long tasks; if flake JS stays under ~4 ms under 6× throttling, 200 is safe.
