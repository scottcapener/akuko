"use client";

import { useEffect } from "react";

// Registers the offline app-shell service worker (public/sw.js). Production only:
// in dev a service worker fights Turbopack/HMR and serves stale chunks, so we
// never register it there. Fire-and-forget — failure just means no offline shell.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);
  return null;
}
