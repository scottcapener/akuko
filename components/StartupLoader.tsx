"use client";

import { useEffect, useRef, useState } from "react";

// Start-of-session loading bar for the writer. Shown once per browser session
// (tab) — the first time /write opens — over the blank skeleton that otherwise
// sits there while a big book hydrates. The page calls markWriteReady() when its
// content is up; the bar fills to 100%, then the overlay fades out.
//
// "Session started" lives in sessionStorage. For a direct load the inline script
// in app/layout.tsx sets `data-hc-boot` on <html> before first paint, so the
// server-rendered overlay is already covering the page (no flash of the blank
// editor). For an in-app navigation the effect below sets it instead.

const SESSION_KEY = "hc.sessionStarted";
const FADE_MS = 400;
const FILL_MS = 200;
// Safety net so a load that never reports ready can't trap the user behind the overlay.
const MAX_WAIT_MS = 20000;

let ready = false;
const listeners = new Set<() => void>();

export function markWriteReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((fn) => fn());
}

function setBoot(on: boolean) {
  if (on) document.documentElement.dataset.hcBoot = "";
  else delete document.documentElement.dataset.hcBoot;
}

export default function StartupLoader() {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const active = useRef(false);

  useEffect(() => {
    let started = false;
    try { started = sessionStorage.getItem(SESSION_KEY) === "1"; } catch {}
    if (started) {
      setBoot(false);
      return;
    }
    active.current = true;
    setBoot(true);

    const timers: number[] = [];
    let finished = false;

    // Creep toward 90% so the bar keeps moving while content loads; the last
    // stretch waits for the real ready signal.
    const creep = window.setInterval(() => {
      setProgress((p) => p + (90 - p) * 0.06);
    }, 100);

    function finish() {
      if (finished) return;
      finished = true;
      window.clearInterval(creep);
      setProgress(100);
      timers.push(
        window.setTimeout(() => {
          setLeaving(true);
          timers.push(
            window.setTimeout(() => {
              try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
              setBoot(false);
            }, FADE_MS),
          );
        }, FILL_MS + 60),
      );
    }

    listeners.add(finish);
    if (ready) finish();
    timers.push(window.setTimeout(finish, MAX_WAIT_MS));

    return () => {
      listeners.delete(finish);
      window.clearInterval(creep);
      timers.forEach(window.clearTimeout);
      // Leaving /write mid-load (e.g. redirect to login) must not leave the
      // overlay armed for the next page.
      if (active.current) setBoot(false);
      ready = false;
    };
  }, []);

  return (
    <div
      className="hc-boot"
      aria-hidden
      style={{
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <div className="hc-boot-track">
        <div
          className="hc-boot-fill"
          style={{ width: `${progress}%`, transition: `width ${FILL_MS}ms ease-out` }}
        />
      </div>
    </div>
  );
}
